import { fromMinutes, toMinutes } from './date'
import { taskMinutes, trim, workSegments } from './workday'
import type { Task, TimeboxKey, WorkHours } from '../types'

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
