import { addDaysKey, dayKey, dayOfIso, diffDays, lastNDays } from './date'
import { isWorkDay, taskMinutes, workMinutes } from './workday'
import {
  PRIORITIES,
  UNCATEGORIZED,
  type Priority,
  type Settings,
  type Source,
  type Task,
} from '../types'

/* =========================================================
 * 分析ビュー用の集計
 *
 * 集計はすべてここに置き、画面側は数字を並べるだけにする。
 * 追加のストアは持たず、タスク自身の createdAt / doneAt から出す。
 * =======================================================*/

export interface DayPoint {
  key: string
  /** その日に完了した件数 */
  done: number
  /** その日に登録された件数 */
  added: number
  /** 完了 / (完了 + その日を期限に残した未完了) の割合 0〜100。データなしは null */
  rate: number | null
}

/** 直近 n 日の登録・完了の推移 */
export function dailyPoints(tasks: Task[], n: number, today = dayKey()): DayPoint[] {
  const days = lastNDays(today, n)
  const doneBy = new Map<string, number>()
  const addedBy = new Map<string, number>()
  const dueBy = new Map<string, number>()

  for (const t of tasks) {
    if (t.doneAt) {
      const k = dayOfIso(t.doneAt) as string
      doneBy.set(k, (doneBy.get(k) ?? 0) + 1)
    }
    const c = dayOfIso(t.createdAt) ?? t.createdAt.slice(0, 10)
    addedBy.set(c, (addedBy.get(c) ?? 0) + 1)
    if (t.due) dueBy.set(t.due, (dueBy.get(t.due) ?? 0) + 1)
  }

  return days.map((key) => {
    const done = doneBy.get(key) ?? 0
    const due = dueBy.get(key) ?? 0
    const denom = Math.max(done, due)
    return {
      key,
      done,
      added: addedBy.get(key) ?? 0,
      rate: denom > 0 ? Math.round((done / denom) * 100) : null,
    }
  })
}

/** from〜to（両端を含む）の推移。分析の期間に合わせて出すときに使う */
export function pointsBetween(tasks: Task[], from: string, to: string): DayPoint[] {
  const n = Math.max(1, diffDays(to, from) + 1)
  return dailyPoints(tasks, n, to)
}

/** 最初にデータが出る日より前の空白日を落として左詰めにする */
export function trimLeadingEmpty(points: DayPoint[]): DayPoint[] {
  const first = points.findIndex((p) => p.done > 0 || p.added > 0)
  return first < 0 ? [] : points.slice(first)
}

export interface CategoryStat {
  category: string
  open: number
  done: number
  total: number
  /** 完了率 0〜1 */
  rate: number
}

/**
 * 区分ごとの残・完了。件数の多い順。
 * 区分を複数持つタスクは、**そのすべて**で1件ずつ数える（件数なので重複してよい）。
 * 時間の集計（categoryMinutes）と数え方が違う点に注意。
 */
export function categoryStats(tasks: Task[]): CategoryStat[] {
  const map = new Map<string, { open: number; done: number }>()
  for (const t of tasks) {
    const keys = t.categories.length > 0 ? t.categories : [UNCATEGORIZED]
    for (const key of keys) {
      const cur = map.get(key) ?? { open: 0, done: 0 }
      if (t.status === 'done') cur.done++
      else cur.open++
      map.set(key, cur)
    }
  }
  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      open: v.open,
      done: v.done,
      total: v.open + v.done,
      rate: v.open + v.done > 0 ? v.done / (v.open + v.done) : 0,
    }))
    .sort((a, b) => b.total - a.total)
}

/** 未完了タスクの優先度分布 */
export function priorityDist(tasks: Task[]): Record<Priority, number> {
  const dist: Record<Priority, number> = { high: 0, mid: 0, low: 0 }
  for (const t of tasks) if (t.status === 'open') dist[t.priority]++
  return dist
}

/** 入口ごとの利用実績。どの入口を育てるかの判断に使う（design.md §5.1）。 */
export function sourceStats(tasks: Task[]): { source: Source; count: number }[] {
  const map = new Map<Source, number>()
  for (const t of tasks) map.set(t.source, (map.get(t.source) ?? 0) + 1)
  return [...map.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
}

/** 完了が1件以上ある日を連続で何日続けたか（今日が0件なら昨日までを数える） */
export function computeStreak(tasks: Task[], today = dayKey()): number {
  const days = new Set(tasks.filter((t) => t.doneAt).map((t) => dayOfIso(t.doneAt) as string))
  let cur = days.has(today) ? today : addDaysKey(today, -1)
  let streak = 0
  while (days.has(cur)) {
    streak++
    cur = addDaysKey(cur, -1)
  }
  return streak
}

export interface Workload {
  /** 対象日に期限のある未完了タスク */
  tasks: Task[]
  /** 積み上げた見込み分 */
  planned: number
  /** その日の実働分 */
  capacity: number
  /** planned / capacity */
  ratio: number
  over: number
}

/** その日の勤務時間に対する積み上がり具合 */
export function workloadOf(tasks: Task[], day: string, settings: Settings): Workload {
  const targets = tasks.filter((t) => t.status === 'open' && t.due === day)
  const planned = targets.reduce((s, t) => s + taskMinutes(t, settings.defaultEstimateMin), 0)
  // 休日は積める時間が無い（会社カレンダーの休みも含む）
  const capacity = isWorkDay(day, settings.workHours, settings.workCalendar)
    ? workMinutes(settings.workHours)
    : 0
  return {
    tasks: targets,
    planned,
    capacity,
    ratio: capacity > 0 ? planned / capacity : 0,
    over: Math.max(0, planned - capacity),
  }
}

export interface Overview {
  open: number
  done: number
  overdue: number
  todayOpen: number
  weekOpen: number
  noDue: number
}

export function overview(tasks: Task[], today = dayKey()): Overview {
  const weekEnd = addDaysKey(today, 7)
  let open = 0
  let done = 0
  let overdue = 0
  let todayOpen = 0
  let weekOpen = 0
  let noDue = 0
  for (const t of tasks) {
    if (t.status === 'done') {
      done++
      continue
    }
    open++
    if (!t.due) {
      noDue++
      continue
    }
    if (t.due < today) overdue++
    if (t.due <= today) todayOpen++
    if (t.due >= today && t.due <= weekEnd) weekOpen++
  }
  return { open, done, overdue, todayOpen, weekOpen, noDue }
}

export const PRIORITY_ORDER = PRIORITIES
