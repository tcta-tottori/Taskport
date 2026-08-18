import { fromMinutes, toMinutes, weekdayOf } from './date'
import type { Task, WorkCalendar, WorkHours } from '../types'

/* =========================================================
 * 勤務時間の計算
 *
 * 設定された始業・昼休憩・終業から「その日に実際に手が動く時間」を出し、
 * スケジュールビューの目盛りと、積み上げたタスク量の判定に使う。
 * =======================================================*/

export interface Segment {
  /** 0時からの分 */
  from: number
  to: number
  label: string
}

/** 昼休憩と小休憩を合わせた、休んでいる区間の一覧（開始順） */
export function allBreaks(wh: WorkHours): Segment[] {
  const out: Segment[] = []
  const lunch = breakSegment(wh)
  if (lunch) out.push(lunch)
  for (const b of wh.shortBreaks ?? []) {
    const from = toMinutes(b.start)
    const to = toMinutes(b.end)
    if (from !== null && to !== null && to > from) out.push({ from, to, label: '休憩' })
  }
  return out.sort((a, b) => a.from - b.from)
}

/**
 * 実際に手が動く区間。始業から終業までを、休憩でぶつ切りにする。
 * 日報の時間枠がそうなっているので、昼休憩だけでなく小休憩も差し引く。
 */
export function workSegments(wh: WorkHours): Segment[] {
  const start = toMinutes(wh.start) ?? 0
  const end = toMinutes(wh.end) ?? 0
  if (end <= start) return []

  const breaks = allBreaks(wh).filter((b) => b.to > start && b.from < end)
  const segs: Segment[] = []
  let cursor = start
  for (const b of breaks) {
    const from = Math.max(cursor, start)
    const to = Math.min(b.from, end)
    if (to > from) segs.push({ from, to, label: '勤務' })
    cursor = Math.max(cursor, b.to)
  }
  if (end > cursor) segs.push({ from: cursor, to: end, label: '勤務' })

  // 午前・午後の呼び分け（昼休憩をまたぐかで決める）
  const lunch = breakSegment(wh)
  if (lunch) {
    for (const s of segs) s.label = s.to <= lunch.from ? '午前' : '午後'
  }
  return segs
}

/** 昼休憩の区間。設定が不正なら null。 */
export function breakSegment(wh: WorkHours): Segment | null {
  const bs = toMinutes(wh.breakStart)
  const be = toMinutes(wh.breakEnd)
  if (bs === null || be === null || be <= bs) return null
  return { from: bs, to: be, label: '昼休憩' }
}

/** 1日の実働分（休憩を除く） */
export function workMinutes(wh: WorkHours): number {
  return workSegments(wh).reduce((s, seg) => s + (seg.to - seg.from), 0)
}

/**
 * その日付が稼働日か。
 * 会社カレンダー（休日・出勤日の実日付）を渡すと、曜日の設定より優先される。
 */
export function isWorkDay(dayKeyStr: string, wh: WorkHours, cal?: WorkCalendar | null): boolean {
  if (cal) {
    if (cal.workdays.includes(dayKeyStr)) return true
    if (cal.holidays.includes(dayKeyStr)) return false
  }
  return wh.workDays.includes(weekdayOf(dayKeyStr))
}

/** 今この瞬間から終業までに残っている実働分 */
export function remainingWorkMinutes(wh: WorkHours, nowMin: number): number {
  return workSegments(wh).reduce((s, seg) => s + Math.max(0, seg.to - Math.max(seg.from, nowMin)), 0)
}

/** 勤務時間の中に今いるか（休憩中は false） */
export function isWithinWork(wh: WorkHours, nowMin: number): boolean {
  return workSegments(wh).some((seg) => nowMin >= seg.from && nowMin < seg.to)
}

/** 「8:20 〜 17:10（昼休憩 12:25〜13:05／実働 8時間）」の材料 */
export function workHoursSummary(wh: WorkHours): {
  span: string
  breakSpan: string | null
  /** 小休憩の一覧。「10:20〜10:25」の形 */
  shortBreaks: string[]
  minutes: number
} {
  const br = breakSegment(wh)
  return {
    span: `${trim(wh.start)} 〜 ${trim(wh.end)}`,
    breakSpan: br ? `${trim(fromMinutes(br.from))} 〜 ${trim(fromMinutes(br.to))}` : null,
    shortBreaks: (wh.shortBreaks ?? []).map((b) => `${trim(b.start)}〜${trim(b.end)}`),
    minutes: workMinutes(wh),
  }
}

/** 表示用に "08:20" の先頭ゼロを落とす（"8:20"） */
export function trim(hhmm: string): string {
  return hhmm.replace(/^0/, '')
}

/**
 * タスクが占める見込み分。未見積は既定値で埋める。
 * ここを一本にしておかないと、稼働率とタイムラインの帯の長さがずれる。
 */
export function taskMinutes(task: Task, defaultEstimateMin: number): number {
  return typeof task.estimateMin === 'number' && task.estimateMin > 0
    ? task.estimateMin
    : defaultEstimateMin
}

export interface DayLoad {
  /** 積み上げた見込み分 */
  planned: number
  /** その日の実働分 */
  capacity: number
  /** planned / capacity（0〜） */
  ratio: number
  /** 実働を超えた分。0 なら収まっている */
  over: number
}

/**
 * その日ぶんのタスクが勤務時間に収まるか。
 * 会社カレンダーを渡すと、休みの日は積める時間が 0 になる。
 */
export function dayLoad(
  tasks: Task[],
  wh: WorkHours,
  defaultEstimateMin: number,
  day?: string,
  cal?: WorkCalendar | null,
): DayLoad {
  const capacity = day && !isWorkDay(day, wh, cal) ? 0 : workMinutes(wh)
  const planned = tasks.reduce((s, t) => s + taskMinutes(t, defaultEstimateMin), 0)
  return {
    planned,
    capacity,
    ratio: capacity > 0 ? planned / capacity : 0,
    over: Math.max(0, planned - capacity),
  }
}

/* ---------------------------------------------------------
 * タイムラインへの配置
 * ------------------------------------------------------- */

export interface Placed {
  task: Task
  /** 0時からの分 */
  from: number
  to: number
  /** 昼休憩や勤務時間外にはみ出しているか */
  outside: boolean
}

/**
 * 時刻指定のあるタスクを勤務時間の帯の上へ置く。
 * 時刻なしのタスクは配置せず、呼び出し側で「時間未指定」として別に並べる。
 */
export function placeTimed(tasks: Task[], wh: WorkHours, defaultEstimateMin: number): Placed[] {
  const segs = workSegments(wh)
  const out: Placed[] = []
  const breaks = allBreaks(wh)
  for (const t of tasks) {
    const from = t.dueTime ? toMinutes(t.dueTime) : null
    if (from === null) continue
    const to = from + taskMinutes(t, defaultEstimateMin)
    const inWork = segs.some((s) => from >= s.from && from < s.to)
    const inBreak = breaks.some((b) => from >= b.from && from < b.to)
    out.push({ task: t, from, to, outside: !inWork || inBreak })
  }
  return out.sort((a, b) => a.from - b.from)
}
