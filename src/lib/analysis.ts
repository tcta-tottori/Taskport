import {
  addDaysKey,
  addMonths,
  diffDays,
  formatMD,
  formatMDShort,
  monthDays,
  monthKey,
  monthLabel,
  startOfWeek,
  weekdayOf,
} from './date'
import { entriesInRange, type WorkEntry } from './worklog'
import { isWorkDay, workMinutes } from './workday'
import { colorOfGroup, groupOf, primaryCategory } from './workCategories'
import { NO_JOB } from './jobs'
import {
  UNCATEGORIZED,
  UNGROUPED,
  type CategoryColor,
  type CategoryGroup,
  type Plan,
  type Settings,
  type Task,
  type WorkRun,
} from '../types'

/* =========================================================
 * 分析の期間と集計
 *
 * 分析の画面は「日・週・月・全体」を上で切り替えて、同じ面を同じ数え方で見る。
 * 期間の決め方（どこからどこまでか）と、その期間の集計をここに集約する。
 *
 * 【数えるのは押して測った時間だけ】
 * 素は `worklog.entriesInRange`（実行の記録＋あとから足した記録）ひとつだけで、
 * 円グラフ・時間帯・区分ごとの時間・工数はすべてそこから出す。
 * 見込みで埋めない（予定を入れただけの日が働いたことになる）。
 *
 * 【時間は主区分（先頭）にだけ積む】
 * 区分を複数付けた仕事に同じ時間を積むと、合計が勤務時間を超えて
 * 稼働の判断が狂う（CLAUDE.md §9）。
 * =======================================================*/

export type Span = 'day' | 'week' | 'month' | 'all'

export const SPANS: { key: Span; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '週' },
  { key: 'month', label: '月' },
  { key: 'all', label: '全体' },
]

export interface Period {
  span: Span
  /** 期間の中の1日。送り（前・次）はこの日を動かす */
  anchor: string
  /** "YYYY-MM-DD"（この日を含む） */
  from: string
  /** "YYYY-MM-DD"（この日を含む） */
  to: string
  /** 期間に含まれる日（古い順） */
  days: string[]
  /** 見出しに出す名前 */
  label: string
  /** 次の期間があるか（先の日は出さない） */
  hasNext: boolean
  /** 1日ぶんか（時間帯を実物の帯で出せる） */
  single: boolean
}

/** 期間を決める。`firstDay` は全体のときの始まり（記録のある最初の日） */
export function periodOf(span: Span, anchor: string, today: string, firstDay: string): Period {
  if (span === 'day') {
    return {
      span,
      anchor,
      from: anchor,
      to: anchor,
      days: [anchor],
      label: formatMD(anchor),
      hasNext: anchor < today,
      single: true,
    }
  }
  if (span === 'week') {
    const from = startOfWeek(anchor)
    const to = addDaysKey(from, 6)
    return {
      span,
      anchor,
      from,
      to,
      days: daysBetween(from, to),
      label: `${formatMDShort(from)}〜${formatMDShort(to)}`,
      hasNext: to < today,
      single: false,
    }
  }
  if (span === 'month') {
    const month = monthKey(anchor)
    const days = monthDays(month)
    return {
      span,
      anchor,
      from: days[0],
      to: days[days.length - 1],
      days,
      label: monthLabel(month),
      hasNext: days[days.length - 1] < today,
      single: false,
    }
  }
  const from = firstDay < today ? firstDay : today
  return {
    span,
    anchor: today,
    from,
    to: today,
    days: daysBetween(from, today),
    label: '全体',
    hasNext: false,
    single: false,
  }
}

/** 期間を前後へ動かしたときの起点の日 */
export function shiftAnchor(span: Span, anchor: string, step: -1 | 1): string {
  if (span === 'day') return addDaysKey(anchor, step)
  if (span === 'week') return addDaysKey(anchor, step * 7)
  if (span === 'month') return `${addMonths(monthKey(anchor), step)}-01`
  return anchor
}

/** from〜to の日付（両端を含む）。長すぎる期間で膨らまないよう上限を置く */
function daysBetween(from: string, to: string): string[] {
  const n = Math.max(0, diffDays(to, from))
  const out: string[] = []
  for (let i = 0; i <= Math.min(n, 3660); i++) out.push(addDaysKey(from, i))
  return out
}

/* ---------------------------------------------------------
 * 集計
 * ------------------------------------------------------- */

export interface GroupTime {
  group: string
  color: CategoryColor
  minutes: number
  /** 全体に占める割合 0〜1 */
  share: number
  /** うち予定（打合せなど） */
  planMinutes: number
  /** 内訳（区分ごと） */
  items: { category: string; minutes: number }[]
}

/** 「どの作業にどれだけかかったか」の1行。書き出しにもそのまま使う */
export interface EffortRow {
  key: string
  title: string
  category: string
  group: string
  /** 案件のID。'' は案件なし */
  jobId: string
  minutes: number
  /** 何回に分けて手を動かしたか */
  count: number
  /** 何日にまたがったか */
  days: number
}

export interface RangeStats {
  period: Period
  /** 期間の実績（1件ずつ） */
  entries: WorkEntry[]
  /** 実測の合計（分） */
  total: number
  /** うち予定（打合せなど）ぶん */
  planMinutes: number
  /** 時刻が分からない実績（合計には入るが、時間帯には出せない） */
  untimedMinutes: number
  /** 数えた記録の件数 */
  count: number
  groups: GroupTime[]
  /** 時刻ごとの合計（0〜23時） */
  byHour: number[]
  /** 曜日ごとの合計（0=日） */
  byWeekday: number[]
  /** 日ごとの合計（期間の日すべて。記録の無い日は0） */
  byDay: { key: string; minutes: number }[]
  /** 作業ごとの工数（多い順） */
  effort: EffortRow[]
  /** 案件ごとの合計（'' は案件なし） */
  byJob: Map<string, number>
  /** 期間の実働（勤務時間の合計） */
  capacity: number
  /** 稼働日の数 */
  workDays: number
  /** 記録のあった日の数 */
  activeDays: number
  /** その期間に完了したのに、時間を数えていない仕事の件数 */
  unmeasured: number
  /** その期間に完了した件数 */
  done: number
}

/** 切れの数の上限。これを超えたぶんは「その他」へ畳む（色を作らない） */
const SHARE_MAX = 8

export function analyzeRange(input: {
  tasks: Task[]
  plans: Plan[]
  runs: WorkRun[]
  period: Period
  settings: Settings
  now?: number
}): RangeStats {
  const { tasks, plans, runs, period, settings } = input
  const now = input.now ?? Date.now()
  const master = settings.categoryGroups
  const entries = entriesInRange(tasks, runs, period.from, period.to, (c) => groupOf(master, c), now)

  const jobOfTask = new Map(tasks.map((t) => [t.id, t.jobId ?? NO_JOB]))
  const jobOfPlan = new Map(plans.map((p) => [p.id, p.jobId ?? NO_JOB]))

  const byGroup = new Map<
    string,
    { minutes: number; planMinutes: number; items: Map<string, number> }
  >()
  const byHour = new Array<number>(24).fill(0)
  const byWeekday = new Array<number>(7).fill(0)
  const byDayMap = new Map<string, number>()
  const byJob = new Map<string, number>()
  const effortMap = new Map<string, EffortRow & { dayKeys: Set<string> }>()

  let total = 0
  let planMinutes = 0
  let untimedMinutes = 0

  for (const e of entries) {
    total += e.minutes
    if (e.kind === 'plan') planMinutes += e.minutes

    const g = byGroup.get(e.group) ?? {
      minutes: 0,
      planMinutes: 0,
      items: new Map<string, number>(),
    }
    g.minutes += e.minutes
    if (e.kind === 'plan') g.planMinutes += e.minutes
    const catKey = e.category || UNCATEGORIZED
    g.items.set(catKey, (g.items.get(catKey) ?? 0) + e.minutes)
    byGroup.set(e.group, g)

    byDayMap.set(e.day, (byDayMap.get(e.day) ?? 0) + e.minutes)
    byWeekday[weekdayOf(e.day)] += e.minutes

    if (e.from === null || e.to === null) untimedMinutes += e.minutes
    else spreadHours(byHour, e.from, e.to, e.minutes)

    const jobId =
      (e.taskId ? jobOfTask.get(e.taskId) : e.planId ? jobOfPlan.get(e.planId) : NO_JOB) ?? NO_JOB
    byJob.set(jobId, (byJob.get(jobId) ?? 0) + e.minutes)

    const key = `${e.title}/${catKey}/${jobId}`
    const row = effortMap.get(key)
    if (row) {
      row.minutes += e.minutes
      row.count += 1
      row.dayKeys.add(e.day)
    } else {
      effortMap.set(key, {
        key,
        title: e.title,
        category: catKey,
        group: e.group,
        jobId,
        minutes: e.minutes,
        count: 1,
        days: 0,
        dayKeys: new Set([e.day]),
      })
    }
  }

  const groups: GroupTime[] = [...byGroup.entries()]
    .map(([group, v]) => ({
      group,
      color: colorOfGroup(master, group),
      minutes: v.minutes,
      planMinutes: v.planMinutes,
      share: total > 0 ? v.minutes / total : 0,
      items: [...v.items.entries()]
        .map(([category, minutes]) => ({ category, minutes }))
        .sort((a, b) => b.minutes - a.minutes),
    }))
    .sort((a, b) => b.minutes - a.minutes)

  const effort: EffortRow[] = [...effortMap.values()]
    .map(({ dayKeys, ...row }) => ({ ...row, days: dayKeys.size }))
    .sort((a, b) => b.minutes - a.minutes)

  // 期間に完了した仕事のうち、時間を数えていないもの
  let unmeasured = 0
  let done = 0
  const measured = new Set(entries.map((e) => e.taskId).filter((id): id is string => !!id))
  for (const t of tasks) {
    if (t.status !== 'done' || !t.doneAt) continue
    const day = t.doneAt.slice(0, 10)
    if (day < period.from || day > period.to) continue
    done++
    if (!measured.has(t.id)) unmeasured++
  }

  let capacity = 0
  let workDays = 0
  for (const d of period.days) {
    if (!isWorkDay(d, settings.workHours, settings.workCalendar)) continue
    workDays++
    capacity += workMinutes(settings.workHours)
  }

  return {
    period,
    entries,
    total,
    planMinutes,
    untimedMinutes,
    count: entries.length,
    groups,
    byHour,
    byWeekday,
    byDay: period.days.map((key) => ({ key, minutes: byDayMap.get(key) ?? 0 })),
    effort,
    byJob,
    capacity,
    workDays,
    activeDays: byDayMap.size,
    unmeasured,
    done,
  }
}

/**
 * 日ごとに測った時間（分）。推移の下に添える細い帯に使う。
 * 期間より長い範囲（推移は日を見ているときでも2週間ぶん出す）を数えるので、
 * `analyzeRange` とは別に引けるようにしてある。
 */
export function minutesByDay(
  tasks: Task[],
  runs: WorkRun[],
  from: string,
  to: string,
  now = Date.now(),
): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entriesInRange(tasks, runs, from, to, () => '', now)) {
    out.set(e.day, (out.get(e.day) ?? 0) + e.minutes)
  }
  return out
}

/**
 * 区間の時間を、またいでいる時刻の枠へ按分する。
 * 開始の時刻へまとめて積むと、13時に始めた3時間の仕事が
 * 「13時台に3時間」になり、時刻ごとの偏りが読めなくなる。
 */
function spreadHours(byHour: number[], from: number, to: number, minutes: number): void {
  const span = Math.max(1, to - from)
  for (let h = Math.floor(from / 60); h <= Math.floor((to - 1) / 60) && h < 24; h++) {
    const lap = Math.min(to, (h + 1) * 60) - Math.max(from, h * 60)
    if (lap <= 0) continue
    byHour[Math.max(0, h)] += (minutes * lap) / span
  }
}

/** 円グラフの切れ。多すぎるぶんは「その他」へ畳む（色を新しく作らない） */
export function toSlices(groups: GroupTime[], master: CategoryGroup[]): GroupTime[] {
  if (groups.length <= SHARE_MAX) return groups
  const head = groups.slice(0, SHARE_MAX - 1)
  const rest = groups.slice(SHARE_MAX - 1)
  const minutes = rest.reduce((s, r) => s + r.minutes, 0)
  const total = groups.reduce((s, r) => s + r.minutes, 0)
  return [
    ...head,
    {
      group: UNGROUPED,
      color: colorOfGroup(master, UNGROUPED),
      minutes,
      planMinutes: rest.reduce((s, r) => s + r.planMinutes, 0),
      share: total > 0 ? minutes / total : 0,
      items: rest.flatMap((r) => r.items),
    },
  ]
}

/* ---------------------------------------------------------
 * 見込みと実績のずれ
 *
 * 見込み（`estimateMin`）を入れて完了し、実績（`actualMin`）も入っている
 * 仕事だけで数える。**片方しか無いものは入れない**（埋めた数字で比べると、
 * 見積の癖ではなく埋め方の癖を見ることになる）。
 * ------------------------------------------------------- */

export interface EstimateStat {
  group: string
  color: CategoryColor
  planned: number
  actual: number
  count: number
}

export function estimateStats(
  tasks: Task[],
  from: string,
  to: string,
  master: CategoryGroup[],
): { rows: EstimateStat[]; planned: number; actual: number; count: number } {
  const map = new Map<string, EstimateStat>()
  let planned = 0
  let actual = 0
  let count = 0
  for (const t of tasks) {
    if (t.status !== 'done' || !t.doneAt) continue
    const day = t.doneAt.slice(0, 10)
    if (day < from || day > to) continue
    if (typeof t.estimateMin !== 'number' || t.estimateMin <= 0) continue
    if (typeof t.actualMin !== 'number' || t.actualMin <= 0) continue
    const group = groupOf(master, primaryCategory(t.categories))
    const cur = map.get(group) ?? {
      group,
      color: colorOfGroup(master, group),
      planned: 0,
      actual: 0,
      count: 0,
    }
    cur.planned += t.estimateMin
    cur.actual += t.actualMin
    cur.count++
    map.set(group, cur)
    planned += t.estimateMin
    actual += t.actualMin
    count++
  }
  return { rows: [...map.values()].sort((a, b) => b.actual - a.actual), planned, actual, count }
}
