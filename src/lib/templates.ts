import { ulid } from './ulid'
import { cleanCategories } from './workCategories'
import { TEMPLATE_KEEP, type Draft, type Task, type TaskTemplate } from '../types'

/* =========================================================
 * 記憶したタスク（定型）
 *
 * 「毎回おなじことを打ち直す」をなくすための控え。
 * 登録した時点で自動的に控え、直接入力の画面から呼び出して埋める。
 *
 * 期限は控えない。日付は毎回違うし、古い日付が入ったまま登録されると
 * 黙って超過扱いになる（呼び出したあとに人が入れる）。
 *
 * 端末内にのみ置く。同期にも書き出しにも乗せない。
 * =======================================================*/

/** 同じものとみなす鍵。件名だけで見る（同じ件名を2つ覚えても選べない）。 */
function keyOf(title: string): string {
  return title.trim().normalize('NFKC').toLowerCase()
}

/** タスクから控えを作る */
export function templateOf(task: Task | Draft): TaskTemplate {
  return {
    id: ulid(),
    title: task.title.trim(),
    note: task.note.trim(),
    categories: cleanCategories(task.categories),
    priority: task.priority,
    estimateMin: task.estimateMin,
    timebox: task.timebox,
    steps: task.subtasks.map((s) => s.title.trim()).filter(Boolean),
    useCount: 1,
    lastUsedAt: new Date().toISOString(),
  }
}

/**
 * 控えに1件足す（同じ件名があれば回数を増やして中身を新しいほうへ寄せる）。
 * 件名が空のものは控えない。
 */
export function remember(list: TaskTemplate[], task: Task | Draft): TaskTemplate[] {
  const next = templateOf(task)
  if (!next.title) return list
  const key = keyOf(next.title)
  const found = list.find((t) => keyOf(t.title) === key)
  const merged = found
    ? [
        { ...next, id: found.id, useCount: found.useCount + 1 },
        ...list.filter((t) => t.id !== found.id),
      ]
    : [next, ...list]
  return prune(merged)
}

/** 使った回数を1つ増やし、最後に使った時刻を更新する */
export function touch(list: TaskTemplate[], id: string): TaskTemplate[] {
  const now = new Date().toISOString()
  return list.map((t) => (t.id === id ? { ...t, useCount: t.useCount + 1, lastUsedAt: now } : t))
}

export function forget(list: TaskTemplate[], id: string): TaskTemplate[] {
  return list.filter((t) => t.id !== id)
}

/** あふれたぶんを捨てる。よく使う・最近使ったものを残す。 */
function prune(list: TaskTemplate[]): TaskTemplate[] {
  if (list.length <= TEMPLATE_KEEP) return list
  return [...list].sort(rank).slice(0, TEMPLATE_KEEP)
}

/** 並び順: よく使う順 → 最近使った順 */
export function rank(a: TaskTemplate, b: TaskTemplate): number {
  if (a.useCount !== b.useCount) return b.useCount - a.useCount
  return b.lastUsedAt.localeCompare(a.lastUsedAt)
}

/** 語で絞る（件名・メモ・区分を見る） */
export function searchTemplates(list: TaskTemplate[], q: string): TaskTemplate[] {
  const terms = q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean)
  const hit =
    terms.length === 0
      ? [...list]
      : list.filter((t) => {
          const hay = `${t.title} ${t.note} ${t.categories.join(' ')}`.normalize('NFKC').toLowerCase()
          return terms.every((w) => hay.includes(w))
        })
  return hit.sort(rank)
}

/** 控えを Draft へ流し込む。期限と時刻は触らない（毎回違うため）。 */
export function applyTemplate(draft: Draft, t: TaskTemplate): Draft {
  return {
    ...draft,
    title: t.title,
    note: t.note,
    categories: [...t.categories],
    priority: t.priority,
    estimateMin: t.estimateMin,
    timebox: t.timebox,
    subtasks: t.steps.map((title) => ({ id: ulid(), title, done: false })),
  }
}
