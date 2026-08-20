import { fromMinutes, toMinutes } from './date'
import { planMinutes } from './plans'
import { taskMinutes, trim, workSegments } from './workday'
import type { PlanOccurrence, Task, TimeboxKey, WorkHours } from '../types'

/* =========================================================
 * タイムボックス（時間枠）
 *
 * タスクを一覧として持つだけだと、「その日に本当に入るのか」は
 * 全部やってみるまで分からない。時間の帯に割り当てておくと、
 *   - 次に何をやるか毎回考えなくて済む（帯の中の1件をやるだけ）
 *   - 枠の長さと見積もりの合計を並べられるので、詰め込みすぎが朝に分かる
 * の2つが効く。
 *
 * 枠は勤務時間の区切りそのもの（＝日報の時間区分）を使う。
 * 独自の時間割を作らないのは、日報へ書き写すときにずれるため。
 * =======================================================*/

export interface Band {
  key: TimeboxKey
  /** 「午前 前半」 */
  label: string
  /** 「8:20〜10:20」。時間外は空 */
  span: string
  /** 0時からの分。時間外は null */
  from: number | null
  to: number | null
  /** 枠の長さ（分）。時間外は null（上限がない） */
  minutes: number | null
}

const IN_DAY: { key: TimeboxKey; label: string }[] = [
  { key: 'am1', label: '午前 前半' },
  { key: 'am2', label: '午前 後半' },
  { key: 'pm1', label: '午後 前半' },
  { key: 'pm2', label: '午後 後半' },
]

export const OUT_BAND: Band = {
  key: 'out',
  label: '時間外',
  span: '始業前・終業後',
  from: null,
  to: null,
  minutes: null,
}

/**
 * 勤務時間から枠を組み立てる。
 * 休憩で区切られた区間が4つでないとき（勤務時間を変えた場合）は、
 * 取れた数だけを前から当て、足りない枠は出さない。
 */
export function bands(wh: WorkHours): Band[] {
  const segs = workSegments(wh)
  const out: Band[] = []
  for (let i = 0; i < Math.min(segs.length, IN_DAY.length); i++) {
    const s = segs[i]
    out.push({
      ...IN_DAY[i],
      span: `${trim(fromMinutes(s.from))}〜${trim(fromMinutes(s.to))}`,
      from: s.from,
      to: s.to,
      minutes: s.to - s.from,
    })
  }
  out.push(OUT_BAND)
  return out
}

export function bandOf(key: TimeboxKey | null, wh: WorkHours): Band | null {
  if (!key) return null
  return bands(wh).find((b) => b.key === key) ?? null
}

export function timeboxLabel(key: TimeboxKey | null, wh: WorkHours): string {
  return bandOf(key, wh)?.label ?? ''
}

/**
 * タスクがどの枠に入るか。
 *   1. 自分で割り当てていればそれ
 *   2. 時刻が入っていれば、その時刻を含む枠
 *   3. どちらも無ければ未割り当て（null）
 * 時刻から自動で決めるのは、時刻を入れた時点で帯も決まっているため。
 * 推測ではなく計算なので、確認画面に出しても嘘にならない。
 */
export function timeboxOf(task: Task, wh: WorkHours): TimeboxKey | null {
  if (task.timebox) return task.timebox
  const min = task.dueTime ? toMinutes(task.dueTime) : null
  if (min === null) return null
  for (const b of bands(wh)) {
    if (b.from !== null && b.to !== null && min >= b.from && min < b.to) return b.key
  }
  return 'out'
}

/** いまの時刻がどの枠か。休憩中は次の枠を返す。終業後は 'out'。 */
export function currentBand(wh: WorkHours, nowMin: number): TimeboxKey {
  const bs = bands(wh).filter((b) => b.from !== null && b.to !== null)
  for (const b of bs) {
    if (nowMin < (b.to as number)) return b.key
  }
  return 'out'
}

export interface BandLoad {
  band: Band
  tasks: Task[]
  /** 見積もりの合計（分） */
  planned: number
  /** 枠の長さ。時間外は null */
  capacity: number | null
  /** 枠からあふれた分。時間外と、収まっているときは 0 */
  over: number
}

/**
 * 枠ごとの積み上げ。渡すのは「その日にやる未完了タスク」だけ。
 * 未割り当てのタスクは戻り値に含めない（呼び出し側で別に並べる）。
 */
export function bandLoads(tasks: Task[], wh: WorkHours, defaultEstimateMin: number): BandLoad[] {
  const list = bands(wh)
  return list.map((band) => {
    const mine = tasks.filter((t) => timeboxOf(t, wh) === band.key)
    const planned = mine.reduce((s, t) => s + taskMinutes(t, defaultEstimateMin), 0)
    return {
      band,
      tasks: mine,
      planned,
      capacity: band.minutes,
      over: band.minutes === null ? 0 : Math.max(0, planned - band.minutes),
    }
  })
}

/** 枠に入れていないタスク */
export function unboxed(tasks: Task[], wh: WorkHours): Task[] {
  return tasks.filter((t) => timeboxOf(t, wh) === null)
}

/**
 * 「いま やる1件」。
 * 迷う時間を減らすのが目的なので、必ず1件だけ返す。
 *
 *   1. いまの枠に入っているもの
 *   2. 通り過ぎた枠に残っているもの（やり残し）
 *   3. 枠に入れていないもの
 * の順に見て、それぞれの中では期限・時刻・優先度の順（sortTasks 済みの並び）。
 */
export function nextUp(tasks: Task[], wh: WorkHours, nowMin: number): Task | null {
  const open = tasks.filter((t) => t.status === 'open')
  if (open.length === 0) return null
  const order = bands(wh).map((b) => b.key)
  const now = currentBand(wh, nowMin)
  const nowIdx = order.indexOf(now)

  const inBand = (key: TimeboxKey) => open.filter((t) => timeboxOf(t, wh) === key)

  const current = inBand(now)
  if (current.length > 0) return current[0]

  // 通り過ぎた枠のやり残し（近い枠から遡る）
  for (let i = nowIdx - 1; i >= 0; i--) {
    const left = inBand(order[i])
    if (left.length > 0) return left[0]
  }

  const rest = unboxed(open, wh)
  if (rest.length > 0) return rest[0]

  // 先の枠しか残っていないなら、その先頭
  for (let i = nowIdx + 1; i < order.length; i++) {
    const ahead = inBand(order[i])
    if (ahead.length > 0) return ahead[0]
  }
  return null
}

/* =========================================================
 * その日の空き時間へ置く（v1.29.0）
 *
 * 上の「枠」は1日を4つの帯に畳んだ粗い見方で、スケジュールの縦軸
 * （`DayTimeline`）は実時刻の並び。**置き場を決めるのはこちら**で、
 * 「いつやるか決めていない仕事」を、空いているところへ実時刻で置く。
 *
 * 守っていること
 *   - 休憩と、すでに入っている予定・時刻の決まった仕事は避ける
 *   - **今日は、いまより前には置かない**（過ぎた時間に置かせない）
 *   - 使うのは見込み（`estimateMin`）だけ。実績（`actualMin`）には触らない
 *   - 入りきらないときは詰めない。置けないことを画面に出す
 *
 * 稼働の集計には混ぜない。ここは「これからの置き場」を出すだけで、
 * 数えるのは押して測った時間だけ（`lib/worklog.ts` の `measuredOfDay`）。
 * =======================================================*/

export interface Slot {
  /** 0時からの分 */
  from: number
  to: number
}

/** 合計の空き（分） */
export function freeMinutes(slots: Slot[]): number {
  return slots.reduce((n, s) => n + Math.max(0, s.to - s.from), 0)
}

/** 重なった区間をつなげる（開始順） */
function mergeSlots(list: Slot[]): Slot[] {
  const sorted = [...list].filter((s) => s.to > s.from).sort((a, b) => a.from - b.from)
  const out: Slot[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  return out
}

/**
 * すでに埋まっている区間。
 * 時刻の決まった**未完了**タスク（見込みの長さぶん）と、終日でない予定を集める。
 * 済んだ仕事はもう手が空いているので、埋まっているとみなさない。
 */
export function busySlots(
  tasks: Task[],
  occurrences: PlanOccurrence[],
  defaultEstimateMin: number,
): Slot[] {
  const out: Slot[] = []
  for (const t of tasks) {
    if (t.status === 'done' || !t.dueTime) continue
    const from = toMinutes(t.dueTime)
    if (from === null) continue
    out.push({ from, to: from + taskMinutes(t, defaultEstimateMin) })
  }
  for (const o of occurrences) {
    if (o.plan.allDay) continue
    const from = toMinutes(o.plan.startTime ?? '')
    if (from === null) continue
    out.push({ from, to: from + planMinutes(o.plan) })
  }
  return mergeSlots(out)
}

/**
 * 空いている区間。勤務している時間（休憩を抜いたもの）から、埋まっている区間を引く。
 * `notBefore` を渡すと、それより前は空きにしない（今日はいまの時刻を渡す）。
 */
export function freeSlots(wh: WorkHours, busy: Slot[], notBefore: number | null = null): Slot[] {
  const out: Slot[] = []
  for (const seg of workSegments(wh)) {
    let cursor = notBefore === null ? seg.from : Math.max(seg.from, notBefore)
    for (const b of busy) {
      if (b.to <= cursor) continue
      if (b.from >= seg.to) break
      if (b.from > cursor) out.push({ from: cursor, to: Math.min(b.from, seg.to) })
      cursor = Math.max(cursor, b.to)
      if (cursor >= seg.to) break
    }
    if (cursor < seg.to) out.push({ from: cursor, to: seg.to })
  }
  return out.filter((s) => s.to > s.from)
}

/** 置き先を丸める単位（分）。時刻の見た目を揃える */
const STEP = 5

/**
 * 見込み `minutes` の仕事が入る、いちばん早い開始時刻（0時からの分）。
 * どこにも入らなければ null。
 *
 * 開始は5分刻みに切り上げる（区間の頭が 10:22 でも「10:25 に置く」と読める形にする。
 * 切り上げたぶんが区間からはみ出さないことは、その場で確かめている）。
 */
export function firstFit(minutes: number, slots: Slot[]): number | null {
  const need = Math.max(1, Math.round(minutes))
  for (const s of slots) {
    const start = Math.ceil(s.from / STEP) * STEP
    if (start + need <= s.to) return start
  }
  return null
}

/** 「10:25」。置き先を釦に出すのに使う */
export function fitLabel(min: number): string {
  return fromMinutes(min)
}
