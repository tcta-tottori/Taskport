import { addDaysKey, dayKey, dayOfIso, lastNDays } from './date'
import { isWorkDay, taskMinutes, workMinutes } from './workday'
import { loggedMinutes, measuredMin, ofDay } from './worklog'
import { runSeconds } from './runs'
import { planMinutes } from './plans'
import { colorOfGroup, groupOf, primaryCategory } from './workCategories'
import {
  PRIORITIES,
  UNCATEGORIZED,
  UNGROUPED,
  type CategoryColor,
  type CategoryGroup,
  type PlanOccurrence,
  type Priority,
  type WorkRun,
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


/* ---------------------------------------------------------
 * 区分ごとの時間（資材課日報の集計に相当）
 *
 * 日報は 0.25H 刻みで作業内容ごとに時間を積み、大分類ごとの合計と
 * 全体に占める割合を出している。同じ見方を Taskport でも作る。
 *
 * 実績（actualMin）が入っていればそれを積み、入っていないものだけ
 * 見込みで埋める（v1.14.0）。混ざるので、**実績で埋まっている割合**を
 * 一緒に返し、画面はそれを注記に出す。全部が見込みのときに
 * 「実績」と言い切らないための逃げ道であって、注記そのものは消さない。
 *
 * 区分を複数持つタスクは**先頭（主区分）にだけ**時間を積む。
 * ------------------------------------------------------- */

export interface GroupMinutes {
  group: string
  minutes: number
  /** 全体に占める割合 0〜1 */
  share: number
  /** 内訳（小分類ごと） */
  items: { category: string; minutes: number }[]
}

/**
 * 期間内に完了したタスクの見込み時間を、大分類ごとに合計する。
 * @param from "YYYY-MM-DD"（この日を含む）
 * @param to   "YYYY-MM-DD"（この日を含む）
 */
export function categoryMinutes(
  tasks: Task[],
  from: string,
  to: string,
  defaultEstimateMin: number,
  master: CategoryGroup[],
): { groups: GroupMinutes[]; total: number; actual: number } {
  const byGroup = new Map<string, Map<string, number>>()
  let total = 0
  let actual = 0

  for (const t of tasks) {
    if (t.status !== 'done' || !t.doneAt) continue
    const day = dayOfIso(t.doneAt) as string
    if (day < from || day > to) continue
    // 実績があれば実績。無いものだけ見込みで埋める
    const min = loggedMinutes(t, defaultEstimateMin)
    if (typeof t.actualMin === 'number' && t.actualMin > 0) actual += t.actualMin
    // 時間は主区分（先頭）にだけ積む。区分ごとに同じ時間を積むと
    // 合計が実際の勤務時間を超えて、稼働の判断が狂う。
    const primary = primaryCategory(t.categories)
    const g = groupOf(master, primary)
    const key = primary || UNCATEGORIZED
    const items = byGroup.get(g) ?? new Map<string, number>()
    items.set(key, (items.get(key) ?? 0) + min)
    byGroup.set(g, items)
    total += min
  }

  const groups: GroupMinutes[] = [...byGroup.entries()]
    .map(([group, items]) => {
      const minutes = [...items.values()].reduce((a, b) => a + b, 0)
      return {
        group,
        minutes,
        share: total > 0 ? minutes / total : 0,
        items: [...items.entries()]
          .map(([category, m]) => ({ category, minutes: m }))
          .sort((a, b) => b.minutes - a.minutes),
      }
    })
    .sort((a, b) => b.minutes - a.minutes)

  return { groups, total, actual }
}

/* ---------------------------------------------------------
 * その日の区分の割合（円グラフ）
 *
 * 「その日、どの種類の仕事に何割を使ったか」だけを出す。
 * 拾い方は日報と同じ（`worklog.ofDay`）で、実績が入っていればそれ、
 * 無いものだけ見込みで埋める。**予定（打合せなど）の時間も足す**
 * ——会議に出た時間が抜けると、その日の割合が実際と合わないため。
 *
 * 時間は主区分（先頭）にだけ積む。区分ごとに同じ時間を積むと
 * 合計が実際の勤務時間を超える。
 * ------------------------------------------------------- */

/** 円グラフの1切れ */
export interface DayShare {
  /** グループ名（集計の単位） */
  group: string
  color: CategoryColor
  minutes: number
  /** 0〜1 */
  share: number
  /** うち予定（打合せなど）の分 */
  planMinutes: number
}

/** 切れの数の上限。これを超えたぶんは「その他」へ畳む（色を作らない）。 */
const SHARE_MAX = 8

export function dayShares(
  tasks: Task[],
  plans: PlanOccurrence[],
  day: string,
  defaultEstimateMin: number,
  master: CategoryGroup[],
  /** 実行ログ。渡すと**実測だけ**で数える（見込みで埋めない） */
  runs?: WorkRun[],
  now = Date.now(),
): { slices: DayShare[]; total: number; planMinutes: number; measured: number; unmeasured: number } {
  const byGroup = new Map<string, { minutes: number; planMinutes: number }>()
  let total = 0
  let planTotal = 0
  let measured = 0

  const add = (group: string, minutes: number, fromPlan: boolean) => {
    const cur = byGroup.get(group) ?? { minutes: 0, planMinutes: 0 }
    cur.minutes += minutes
    if (fromPlan) cur.planMinutes += minutes
    byGroup.set(group, cur)
    total += minutes
    if (fromPlan) planTotal += minutes
  }

  // 実測だけで数えるか、見込みで埋めるか
  const exact = Array.isArray(runs)
  let unmeasured = 0

  for (const t of ofDay(tasks, day)) {
    const min = exact ? measuredMin(t, now) : loggedMinutes(t, defaultEstimateMin)
    if (min <= 0) {
      if (exact) unmeasured++
      continue
    }
    if (typeof t.actualMin === 'number' && t.actualMin > 0) measured += t.actualMin
    add(groupOf(master, primaryCategory(t.categories)), min, false)
  }

  for (const o of plans) {
    if (o.day !== day) continue
    // 実測のときは、その予定を実際に動かした分だけ数える（入れただけの予定は0）
    const min = exact
      ? (runs as WorkRun[])
          .filter((r) => r.kind === 'plan' && r.targetId === o.key)
          .reduce((sum, r) => sum + Math.floor(runSeconds(r, now) / 60), 0)
      : planMinutes(o.plan)
    if (min <= 0) continue
    add(groupOf(master, primaryCategory(o.plan.categories)), min, true)
  }

  const all = [...byGroup.entries()]
    .map(([group, v]) => ({
      group,
      color: colorOfGroup(master, group),
      minutes: v.minutes,
      planMinutes: v.planMinutes,
      share: total > 0 ? v.minutes / total : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes)

  // 多すぎるぶんは畳む。色を新しく作らない（design.md §10.1）
  let slices = all
  if (all.length > SHARE_MAX) {
    const head = all.slice(0, SHARE_MAX - 1)
    const rest = all.slice(SHARE_MAX - 1)
    const minutes = rest.reduce((sum, r) => sum + r.minutes, 0)
    slices = [
      ...head,
      {
        group: UNGROUPED,
        color: colorOfGroup(master, UNGROUPED),
        minutes,
        planMinutes: rest.reduce((sum, r) => sum + r.planMinutes, 0),
        share: total > 0 ? minutes / total : 0,
      },
    ]
  }

  return { slices, total, planMinutes: planTotal, measured, unmeasured }
}
