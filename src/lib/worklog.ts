import { dayOfIso, fromMinutes, isoAt, timeKey, timeOfIso, toMinutes } from './date'
import { draftToTask } from './tasks'
import { taskMinutes } from './workday'
import type { Draft, Task } from '../types'

/* =========================================================
 * 実績（実行中の業務・やった業務）
 *
 * 台帳はもともと「これからやること」を持つ形だったが、実際の仕事は
 *   - いま手を動かしている最中のもの
 *   - もう終わっていて、日報に書かないといけないもの
 * のほうが多い。どちらも同じ台帳の1件として持ち、
 * **見込み（estimateMin）と実績（actualMin）を別の項目**にしてある。
 *
 * 混ぜないのは、日報が「実際にかかった時間」で書かれるのに対し、
 * 稼働率の積み上げは「これから積む見込み」だからで、
 * 同じ欄に入れると、片方を直したときにもう片方の意味が変わる。
 *
 * 時間の計算はすべてここに置く。画面側で分を足し引きしない。
 * =======================================================*/

/** 実行中か（手を付けていて、まだ完了していない） */
export function isRunning(task: Task): boolean {
  return task.status === 'open' && !!task.startedAt
}

/** 着手してからいままでの経過分。実行中でなければ 0 */
export function runningMin(task: Task, now = Date.now()): number {
  if (!task.startedAt) return 0
  const from = new Date(task.startedAt).getTime()
  if (Number.isNaN(from)) return 0
  return Math.max(0, Math.floor((now - from) / 60_000))
}

/**
 * 記録上の開始時刻 "HH:mm"。
 * 実際に手を付けた時刻があればそれ、無ければ予定の時刻。どちらも無ければ null。
 */
export function logStartTime(task: Task): string | null {
  return timeOfIso(task.startedAt) ?? task.dueTime
}

/**
 * その日の記録（やったこと・やっていること）に出すか。
 *
 *   - 完了したもの … **完了した日**で見る（期限がいつだったかは関係ない）
 *   - 手を付けたもの … 手を付けた日
 *   - それ以外     … 期限がその日のもの（＝これからやる予定）
 *
 * 期限だけで見ていた頃は、昨日ぶんを今朝片づけた1件が
 * どちらの日の日報にも出てこなかった。
 */
export function isOfDay(task: Task, day: string): boolean {
  if (task.status === 'done') return dayOfIso(task.doneAt) === day
  if (task.startedAt && dayOfIso(task.startedAt) === day) return true
  return task.due === day
}

/** その日の記録を、開始時刻の早い順に並べる。時刻の無いものは後ろ。 */
export function ofDay(tasks: Task[], day: string): Task[] {
  const mine = tasks.filter((t) => isOfDay(t, day))
  return mine.sort((a, b) => {
    const ta = toMinutes(logStartTime(a) ?? '') ?? 9999
    const tb = toMinutes(logStartTime(b) ?? '') ?? 9999
    if (ta !== tb) return ta - tb
    const da = a.doneAt ?? ''
    const db = b.doneAt ?? ''
    if (da !== db) return da < db ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
}

/**
 * 1件ぶんの「その日に使った時間」。
 * 実績が入っていればそれ、無ければ見込み（未見積は既定値）で埋める。
 * 日報と区分ごとの時間はここを通す。
 */
export function loggedMinutes(task: Task, defaultEstimateMin: number): number {
  if (typeof task.actualMin === 'number' && task.actualMin > 0) return task.actualMin
  return taskMinutes(task, defaultEstimateMin)
}

export interface DaySpent {
  /** その日の記録に出るもの */
  tasks: Task[]
  /** 実績が入っているぶんの合計（分） */
  actual: number
  /** 実績が入っていないぶんを見込みで埋めた合計（分） */
  total: number
  /** 実績が入っている件数 */
  measured: number
}

/** その日の積み上がり。実績と、見込みで埋めたぶんを分けて返す。 */
export function daySpent(tasks: Task[], day: string, defaultEstimateMin: number): DaySpent {
  const mine = ofDay(tasks, day)
  let actual = 0
  let total = 0
  let measured = 0
  for (const t of mine) {
    if (typeof t.actualMin === 'number' && t.actualMin > 0) {
      actual += t.actualMin
      measured++
    }
    total += loggedMinutes(t, defaultEstimateMin)
  }
  return { tasks: mine, actual, total, measured }
}

/** いま実行中のもの（複数あれば新しく始めたほうが先） */
export function running(tasks: Task[]): Task[] {
  return tasks
    .filter(isRunning)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
}

/**
 * やった業務を完了済みのタスクとして保存するための差分。
 * 開始時刻とかかった時間から完了時刻を出す（画面側で時刻を組み立てない）。
 */
export function doneFields(
  day: string,
  start: string,
  minutes: number,
): Pick<Task, 'due' | 'startedAt' | 'actualMin' | 'status' | 'doneAt'> {
  const min = minutes > 0 ? Math.round(minutes) : 0
  return {
    due: day,
    startedAt: isoAt(day, start),
    actualMin: min > 0 ? min : null,
    status: 'done',
    doneAt: isoAt(day, start, min),
  }
}

/** いまの時刻を、5分刻みに切り下げた "HH:mm"。記録を足すときの初期値に使う。 */
export function roundedNow(now = new Date()): string {
  const min = toMinutes(timeKey(now)) ?? 0
  return fromMinutes(Math.floor(min / 5) * 5)
}

/** やった業務を、完了済みのタスク1件にする。保存の直前にここを通す。 */
export function logToTask(draft: Draft, day: string, start: string, minutes: number): Task {
  return { ...draftToTask(draft), ...doneFields(day, start, minutes) }
}
