import { fromMinutes, toMinutes, weekdayOf } from './date'
import type { Task, WorkHours } from '../types'

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

/** 始業〜昼休憩前、昼休憩後〜終業 の2区間。休憩が範囲外なら1区間になる。 */
export function workSegments(wh: WorkHours): Segment[] {
  const start = toMinutes(wh.start) ?? 0
  const end = toMinutes(wh.end) ?? 0
  const bs = toMinutes(wh.breakStart)
  const be = toMinutes(wh.breakEnd)
  if (end <= start) return []
  if (bs === null || be === null || be <= bs || bs <= start || be >= end) {
    return [{ from: start, to: end, label: '勤務' }]
  }
  return [
    { from: start, to: bs, label: '午前' },
    { from: be, to: end, label: '午後' },
  ]
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

/** その日付が稼働曜日か */
export function isWorkDay(dayKeyStr: string, wh: WorkHours): boolean {
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

/** 「8:20 〜 17:10（昼休憩 12:25〜13:05／実働 8時間10分）」の材料 */
export function workHoursSummary(wh: WorkHours): {
  span: string
  breakSpan: string | null
  minutes: number
} {
  const br = breakSegment(wh)
  return {
    span: `${trim(wh.start)} 〜 ${trim(wh.end)}`,
    breakSpan: br ? `${trim(fromMinutes(br.from))} 〜 ${trim(fromMinutes(br.to))}` : null,
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

/** その日ぶんのタスクが勤務時間に収まるか */
export function dayLoad(tasks: Task[], wh: WorkHours, defaultEstimateMin: number): DayLoad {
  const capacity = workMinutes(wh)
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
  const br = breakSegment(wh)
  const out: Placed[] = []
  for (const t of tasks) {
    const from = t.dueTime ? toMinutes(t.dueTime) : null
    if (from === null) continue
    const to = from + taskMinutes(t, defaultEstimateMin)
    const inWork = segs.some((s) => from >= s.from && from < s.to)
    const inBreak = br ? from >= br.from && from < br.to : false
    out.push({ task: t, from, to, outside: !inWork || inBreak })
  }
  return out.sort((a, b) => a.from - b.from)
}
