import { DEFAULT_TIME, diffDays, isDayKey, isTimeKey, toMinutes } from './date'
import { trim } from './workday'
import { stepDay, type WorkRule } from './repeat'
import { ulid } from './ulid'
import { cleanCategories } from './workCategories'
import type { Plan, PlanOccurrence, Settings } from '../types'

/* =========================================================
 * 予定（Plan）の生成と展開
 *
 * 予定は「その時間そこにいること」。タスクと違って完了にならず、
 * 時間そのものが埋まる（design.md §10.1）。
 *
 * 繰り返しは**作り置きしない**。毎週の定例を12回ぶん作ると、
 *   - 台帳が未来のもので埋まって、いま何をやるかが見えなくなる
 *   - 時間が変わったときに作り置いた分を全部直すことになる
 * ので、画面に出すときに起点の日から展開する（`occurrencesInRange`）。
 * =======================================================*/

/** 予定の既定の長さ（分）。時刻を入れて終わりを決めていないときに使う。 */
export const DEFAULT_PLAN_MIN = 60

/** 新しい予定の既定の時間帯。空欄から時刻を回させないための下敷き（10:00〜11:00）。 */
function defaultSpan(): { start: string; end: string } {
  const from = toMinutes(DEFAULT_TIME) ?? 600
  const to = Math.min(23 * 60 + 59, from + DEFAULT_PLAN_MIN)
  return {
    start: DEFAULT_TIME,
    end: `${String(Math.floor(to / 60)).padStart(2, '0')}:${String(to % 60).padStart(2, '0')}`,
  }
}

export function emptyPlan(day: string, settings: Settings): Plan {
  const now = new Date().toISOString()
  // 予定はほとんど時間の決まっているものなので、既定で 10:00〜11:00 を入れておく。
  // 終日にするときは切り替えで外れる。
  const span = defaultSpan()
  return {
    id: ulid(),
    title: '',
    note: '',
    place: '',
    jobId: null,
    day,
    startTime: span.start,
    endTime: span.end,
    allDay: false,
    categories: [],
    autoTrack: settings.planAutoTrack,
    repeat: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** 保存する前に形を整える。時刻の前後が逆なら終わりを空にする（嘘の長さを持たせない）。 */
export function cleanPlan(plan: Plan): Plan {
  const start = isTimeKey(plan.startTime) ? plan.startTime : null
  let end = isTimeKey(plan.endTime) ? plan.endTime : null
  if (start && end && (toMinutes(end) ?? 0) <= (toMinutes(start) ?? 0)) end = null
  const allDay = plan.allDay || !start
  return {
    ...plan,
    title: plan.title.trim(),
    note: plan.note.trim(),
    place: plan.place.trim(),
    categories: cleanCategories(plan.categories),
    startTime: allDay ? null : start,
    endTime: allDay ? null : end,
    allDay,
    // 起点の日が無いと展開できないので、繰り返しは落とす
    repeat: isDayKey(plan.day) ? plan.repeat : null,
    updatedAt: new Date().toISOString(),
  }
}

/** 予定が埋める分。終日は 0（その日ぜんぶを埋めたことにはしない） */
export function planMinutes(plan: Plan): number {
  if (plan.allDay || !plan.startTime) return 0
  const from = toMinutes(plan.startTime)
  const to = plan.endTime ? toMinutes(plan.endTime) : null
  if (from === null) return 0
  return to !== null && to > from ? to - from : DEFAULT_PLAN_MIN
}

/** 予定の終わり "HH:mm"。終わりを決めていなければ既定の長さで補う。 */
export function planEnd(plan: Plan): string | null {
  if (plan.allDay || !plan.startTime) return null
  if (plan.endTime) return plan.endTime
  const from = toMinutes(plan.startTime)
  if (from === null) return null
  const to = Math.min(23 * 60 + 59, from + DEFAULT_PLAN_MIN)
  return `${String(Math.floor(to / 60)).padStart(2, '0')}:${String(to % 60).padStart(2, '0')}`
}

/** 「9:00〜10:00」「終日」 */
export function planSpan(plan: Plan): string {
  if (plan.allDay || !plan.startTime) return '終日'
  const end = planEnd(plan)
  return end ? `${trim(plan.startTime)}〜${trim(end)}` : trim(plan.startTime)
}

/** 実行ログと突き合わせる鍵。予定IDと日付から決まる（保存はしない） */
export function occurrenceKey(planId: string, day: string): string {
  return `${planId}:${day}`
}

/** 鍵から予定IDを取り出す（実行ログだけを持っているときに使う） */
export function planIdOf(key: string): string {
  const i = key.indexOf(':')
  return i < 0 ? key : key.slice(0, i)
}

/** 展開の上限。1つの予定がこの回数を超えて並ぶことはない（無限に回さないための箍）。 */
const MAX_OCCURRENCES = 400

/**
 * 予定を期間（from〜to、両端を含む）へ展開する。
 * 繰り返しのないものは、その日が期間に入っていれば1件だけ返す。
 */
export function occurrencesInRange(
  plans: Plan[],
  from: string,
  to: string,
  rule: WorkRule,
): PlanOccurrence[] {
  const out: PlanOccurrence[] = []
  for (const plan of plans) {
    if (!isDayKey(plan.day)) continue
    if (!plan.repeat) {
      if (diffDays(plan.day, from) >= 0 && diffDays(plan.day, to) <= 0) {
        out.push({ plan, day: plan.day, key: occurrenceKey(plan.id, plan.day) })
      }
      continue
    }
    let d = plan.day
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      if (plan.repeat.until && diffDays(d, plan.repeat.until) > 0) break
      if (diffDays(d, to) > 0) break
      if (diffDays(d, from) >= 0) {
        out.push({ plan, day: d, key: occurrenceKey(plan.id, d) })
      }
      d = stepDay(d, plan.repeat, rule)
    }
  }
  return sortOccurrences(out)
}

/** その日ぶんだけ */
export function occurrencesOn(plans: Plan[], day: string, rule: WorkRule): PlanOccurrence[] {
  return occurrencesInRange(plans, day, day, rule)
}

/** 日付 → 時刻の順。終日は先頭にまとめる。 */
export function sortOccurrences(list: PlanOccurrence[]): PlanOccurrence[] {
  return [...list].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1
    const at = a.plan.allDay ? '' : (a.plan.startTime ?? '99:99')
    const bt = b.plan.allDay ? '' : (b.plan.startTime ?? '99:99')
    if (at !== bt) return at < bt ? -1 : 1
    return a.plan.id < b.plan.id ? -1 : 1
  })
}

/** 日付ごとにまとめる（月表示の升目で引くのに使う） */
export function groupOccurrences(list: PlanOccurrence[]): Map<string, PlanOccurrence[]> {
  const map = new Map<string, PlanOccurrence[]>()
  for (const o of list) {
    const cur = map.get(o.day)
    if (cur) cur.push(o)
    else map.set(o.day, [o])
  }
  return map
}

/** その日の予定で埋まっている分の合計（終日は数えない） */
export function bookedMinutes(list: PlanOccurrence[]): number {
  return list.reduce((s, o) => s + planMinutes(o.plan), 0)
}

/**
 * いま進んでいる回。無ければ null。
 * 自動計上と「いま何の時間か」の表示で使う。
 */
export function currentOccurrence(list: PlanOccurrence[], nowMin: number): PlanOccurrence | null {
  for (const o of list) {
    if (o.plan.allDay || !o.plan.startTime) continue
    const from = toMinutes(o.plan.startTime)
    const end = planEnd(o.plan)
    const to = end ? toMinutes(end) : null
    if (from === null || to === null) continue
    if (nowMin >= from && nowMin < to) return o
  }
  return null
}

/** 次に来る回（まだ始まっていないもののうち、いちばん早いもの） */
export function nextOccurrenceOf(list: PlanOccurrence[], nowMin: number): PlanOccurrence | null {
  for (const o of list) {
    if (o.plan.allDay || !o.plan.startTime) continue
    const from = toMinutes(o.plan.startTime)
    if (from !== null && from > nowMin) return o
  }
  return null
}
