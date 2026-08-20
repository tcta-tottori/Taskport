import { dayOfIso, fromMinutes, isoAt, timeKey, timeOfIso, toMinutes } from './date'
import { draftToTask } from './tasks'
import { taskMinutes } from './workday'
import { primaryCategory } from './workCategories'
import type { Draft, Task, WorkRun } from '../types'

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

/** 着手してからいままでの経過秒。実行中でなければ 0（実行中の表示は秒まで出す） */
export function runningSec(task: Task, now = Date.now()): number {
  if (!task.startedAt) return 0
  const from = new Date(task.startedAt).getTime()
  if (Number.isNaN(from)) return 0
  return Math.max(0, Math.floor((now - from) / 1000))
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

/* ---------------------------------------------------------
 * 実際に測れた時間だけを数える（見込みで埋めない）
 *
 * 「本日の稼働」と円グラフはここを通す。見込みを混ぜると、
 * 予定を入れただけの日でも稼働が埋まって見える（v1.22.0 で直した）。
 * ------------------------------------------------------- */

/** タスク1件の実測分。止めてあるぶん（actualMin）＋動いているぶん */
export function measuredMin(task: Task, now = Date.now()): number {
  const stored = typeof task.actualMin === 'number' && task.actualMin > 0 ? task.actualMin : 0
  return stored + (isRunning(task) ? Math.floor(runningSec(task, now) / 60) : 0)
}

/** その日に実際に測れた分（タスク＋予定）。二重に数えないよう、予定はログから取る。 */
export function measuredOfDay(
  tasks: Task[],
  planRunMinutes: number,
  day: string,
  now = Date.now(),
): { total: number; taskMin: number; planMin: number; measuredCount: number; unmeasured: Task[] } {
  const mine = ofDay(tasks, day)
  let taskMin = 0
  let measuredCount = 0
  const unmeasured: Task[] = []
  for (const t of mine) {
    const m = measuredMin(t, now)
    if (m > 0) {
      taskMin += m
      measuredCount++
    } else {
      unmeasured.push(t)
    }
  }
  return {
    total: taskMin + planRunMinutes,
    taskMin,
    planMin: planRunMinutes,
    measuredCount,
    unmeasured,
  }
}

/* ---------------------------------------------------------
 * その日の時間帯（何時に何をしていたか）
 *
 * 分析の帯に出す。拾うのは**実際に測れたものだけ**。
 *   予定・タスクの実行 … 実行ログの区間（開始と終了の時刻がそのまま入っている）
 *   あとから足した記録 … 開始時刻＋かかった時間（`やったことを足す`）
 * 見込みしか無い仕事は置かない（何時にやったか分からないため）。
 * ------------------------------------------------------- */

export interface DaySegment {
  /** 0時からの分 */
  from: number
  to: number
  title: string
  /** 集計の単位（グループ名） */
  group: string
  kind: 'task' | 'plan'
  /** 実績を直すときの相手。予定は直せないので null */
  taskId: string | null
}

export function dayBand(
  tasks: Task[],
  runs: WorkRun[],
  day: string,
  groupOfCategory: (category: string) => string,
  now = Date.now(),
): DaySegment[] {
  const out: DaySegment[] = []

  // 1. 実行ログの区間。タスクも予定も同じ形で入っている
  for (const r of runs) {
    if (r.day !== day) continue
    for (const seg of r.segments) {
      const from = timeOfIso(seg.start)
      if (!from) continue
      const start = toMinutes(from)
      if (start === null) continue
      const endIso = seg.end ?? new Date(now).toISOString()
      const endHm = timeOfIso(endIso)
      const end = endHm ? toMinutes(endHm) : null
      // 日をまたいだ区間は、その日の終わりまでで切る。
      // 1分に満たない区間も 1分ぶんの幅で置く（合計には入っているので、帯から消すと食い違う）
      const to = end === null || end < start ? 24 * 60 : Math.max(end, start + 1)
      out.push({
        from: start,
        to,
        title: r.title,
        group: groupOfCategory(primaryCategory(r.categories)),
        kind: r.kind,
        taskId: r.kind === 'task' ? r.targetId : null,
      })
    }
  }

  // 2. あとから足した記録（実行ログを持たないもの）。開始時刻＋かかった時間で置く
  const logged = new Set(runs.filter((r) => r.day === day).map((r) => r.targetId))
  for (const t of ofDay(tasks, day)) {
    if (logged.has(t.id)) continue
    const min = typeof t.actualMin === 'number' && t.actualMin > 0 ? t.actualMin : 0
    if (min <= 0) continue
    const hm = logStartTime(t)
    const start = hm ? toMinutes(hm) : null
    if (start === null) continue
    out.push({
      from: start,
      to: Math.min(24 * 60, start + min),
      title: t.title,
      group: groupOfCategory(primaryCategory(t.categories)),
      kind: 'task',
      taskId: t.id,
    })
  }

  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}
