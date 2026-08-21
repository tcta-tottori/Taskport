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
 * その記録がどの日のものか。完了した日 → 手を付けた日 → 期限 の順に見る。
 * 実績を直すとき（開始時刻）にも、この日を使って組み立てる。
 */
export function logDay(task: Task): string | null {
  return dayOfIso(task.doneAt) ?? dayOfIso(task.startedAt) ?? task.due
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

/**
 * その日の記録を、開始時刻の早い順に並べる。時刻の無いものは後ろ。
 *
 * 実行ログ（`runs`）を渡すと、**その日に押して動かしたもの**も拾う。
 * 期限の無い仕事は、止めた時点で `startedAt` が消えるので、
 * これを渡さないとその日の集計から丸ごと落ちる（v1.22.1）。
 */
export function ofDay(tasks: Task[], day: string, runs: WorkRun[] = []): Task[] {
  const worked = new Set(runs.filter((r) => r.day === day && r.kind === 'task').map((r) => r.targetId))
  const mine = tasks.filter((t) => isOfDay(t, day) || worked.has(t.id))
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
export function daySpent(
  tasks: Task[],
  day: string,
  defaultEstimateMin: number,
  runs: WorkRun[] = [],
): DaySpent {
  const mine = ofDay(tasks, day, runs)
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
  /** その日の実行ログ。押して動かしたものを拾うために渡す */
  runs: WorkRun[] = [],
  now = Date.now(),
): { total: number; taskMin: number; planMin: number; measuredCount: number; unmeasured: Task[] } {
  const mine = ofDay(tasks, day, runs)
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
 * 実績の1件（時間帯・集計の共通の素）
 *
 * 分析はどれも「いつ・何を・どれだけ」を数えるだけなので、
 * 拾い方をここに1つだけ持ち、円グラフ・時間帯・区分ごとの時間・工数は
 * すべて**同じ配列**から出す（画面ごとに数え方が変わると数字が食い違う）。
 *
 * 拾うのは**実際に測れたものだけ**。
 *   実行の記録（`runs`） … 押した時刻から止めた時刻までの区間
 *   あとから足した記録   … 開始時刻＋かかった時間（`やったことを足す`）
 * 見込みしか無い仕事は置かない（何時にやったか分からないため）。
 *
 * 時刻の分からない実績（開始時刻を消して時間だけ入れたもの）は
 * `from` を null にして残す。**時間の合計には入るが、帯には置かない**
 * （置き場が無いものを 0:00 に置くと、朝いちばんに働いたことになる）。
 * ------------------------------------------------------- */

export interface WorkEntry {
  /** "YYYY-MM-DD" */
  day: string
  /** 0時からの分。時刻が分からない実績は null */
  from: number | null
  /** 終わり（0時からの分）。from が null なら null */
  to: number | null
  /** 数えた分。帯の長さ（to-from）とは別に持つ（秒で足してから丸めるため） */
  minutes: number
  title: string
  /** 主区分（先頭） */
  category: string
  /** 集計の単位（グループ名） */
  group: string
  kind: 'task' | 'plan'
  /** 実績を直すときの相手。予定は直せないので null */
  taskId: string | null
  /** 予定のID（工数の集計に使う）。タスクは null */
  planId: string | null
  /** まだ動いている区間か */
  live: boolean
}

/** 帯に置ける1件（時刻が分かっているもの） */
export interface DaySegment extends WorkEntry {
  from: number
  to: number
}

/** 秒 → 分。20秒以上は1分として数える（台帳の数え方に合わせる） */
function minutesOfSec(sec: number): number {
  return sec >= 20 ? Math.max(1, Math.round(sec / 60)) : 0
}

/** 区間1つの秒数。閉じていない区間は now まで */
function segmentSec(start: string, end: string | null, now: number): number {
  const from = new Date(start).getTime()
  if (Number.isNaN(from)) return 0
  const to = end ? new Date(end).getTime() : now
  if (Number.isNaN(to) || to <= from) return 0
  return Math.floor((to - from) / 1000)
}

/**
 * 期間（from〜to、両端を含む）の実績を1件ずつ並べる。
 * 並びは日→開始時刻の順。時刻の分からないものは、その日の最後に置く。
 */
export function entriesInRange(
  tasks: Task[],
  runs: WorkRun[],
  from: string,
  to: string,
  groupOfCategory: (category: string) => string,
  now = Date.now(),
): WorkEntry[] {
  const out: WorkEntry[] = []
  /** 実行の記録がある仕事。台帳の実績と二重に数えないための控え */
  const logged = new Set<string>()

  for (const r of runs) {
    if (r.day < from || r.day > to) continue
    if (r.kind === 'task') logged.add(r.targetId)
    const category = primaryCategory(r.categories)
    const group = groupOfCategory(category)
    for (const seg of r.segments) {
      const startHm = timeOfIso(seg.start)
      const start = startHm ? toMinutes(startHm) : null
      if (start === null) continue
      const sec = segmentSec(seg.start, seg.end, now)
      const minutes = minutesOfSec(sec)
      // 押し間違い（20秒未満）は置かない。合計にも入っていない
      if (minutes <= 0) continue
      const endHm = seg.end ? timeOfIso(seg.end) : timeOfIso(new Date(now).toISOString())
      const end = endHm ? toMinutes(endHm) : null
      // 日をまたいだ区間は、その日の終わりまでで切る
      const stop = end === null || end < start ? 24 * 60 - 1 : Math.max(end, start + 1)
      out.push({
        day: r.day,
        from: start,
        to: stop,
        minutes,
        title: r.title,
        category,
        group,
        kind: r.kind,
        taskId: r.kind === 'task' ? r.targetId : null,
        planId: r.kind === 'plan' ? r.targetId.split(':')[0] : null,
        live: seg.end === null,
      })
    }
  }

  // あとから足した記録（実行の記録を持たないもの）。開始時刻＋かかった時間で置く
  for (const t of tasks) {
    if (logged.has(t.id)) continue
    const minutes = measuredMin(t, now)
    if (minutes <= 0) continue
    const day = logDay(t)
    if (!day || day < from || day > to) continue
    const hm = logStartTime(t)
    const start = hm ? toMinutes(hm) : null
    const category = primaryCategory(t.categories)
    out.push({
      day,
      from: start,
      to: start === null ? null : Math.min(24 * 60 - 1, start + minutes),
      minutes,
      title: t.title,
      category,
      group: groupOfCategory(category),
      kind: 'task',
      taskId: t.id,
      planId: null,
      live: isRunning(t),
    })
  }

  applyFixedTotals(out, tasks, runs)

  return out.sort(
    (a, b) =>
      (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) ||
      (a.from ?? 9999) - (b.from ?? 9999) ||
      (a.to ?? 9999) - (b.to ?? 9999),
  )
}

/**
 * 人が直した実績（台帳の `actualMin`）があれば、**そちらを正**として合計を合わせる。
 *
 * 実行の記録（区間）は「実際に押した時刻」なので書き換えない（CLAUDE.md §9）。
 * 直せるのは台帳の合計だけなので、区間の位置はそのままに、
 * 数える分だけを比で寄せる（帯は動かず、時間の合計だけが直した値になる）。
 *
 * 直すのは**その日の記録がここに全部そろっているとき**だけ。
 * `actualMin` はその日の合計なので、別の日の記録も持つ仕事に当てると比が狂う。
 * 動いている最中のもの（まだ伸びる）にも当てない。
 */
function applyFixedTotals(entries: WorkEntry[], tasks: Task[], runs: WorkRun[]): void {
  const mine = new Map<string, WorkEntry[]>()
  for (const e of entries) {
    if (e.kind !== 'task' || !e.taskId) continue
    if (e.live) {
      mine.delete(e.taskId)
      continue
    }
    const list = mine.get(e.taskId)
    if (list) list.push(e)
    else mine.set(e.taskId, [e])
  }
  if (mine.size === 0) return

  const taskById = new Map(tasks.map((t) => [t.id, t]))
  for (const [id, list] of mine) {
    const task = taskById.get(id)
    if (!task) continue
    const fixed = typeof task.actualMin === 'number' ? task.actualMin : 0
    if (fixed <= 0) continue
    const days = new Set(list.map((e) => e.day))
    if (days.size !== 1) continue
    const day = [...days][0]
    // 別の日にも記録がある仕事は触らない（actualMin がどの日のぶんか決められない）
    if (runs.some((r) => r.kind === 'task' && r.targetId === id && r.day !== day)) continue
    const sum = list.reduce((s, e) => s + e.minutes, 0)
    if (sum <= 0 || sum === fixed) continue
    // 端数は最後の1件へ寄せて、合計が直した値とぴったり合うようにする
    let left = fixed
    list.forEach((e, i) => {
      const share = i === list.length - 1 ? left : Math.max(1, Math.round((e.minutes / sum) * fixed))
      e.minutes = Math.max(0, i === list.length - 1 ? left : Math.min(share, left))
      left -= e.minutes
    })
  }
}

/** 帯に置けるものだけ（時刻の分かっているもの） */
export function timed(entries: WorkEntry[]): DaySegment[] {
  return entries.filter((e): e is DaySegment => e.from !== null && e.to !== null)
}

/** その日の時間帯。帯に置ける形で返す */
export function dayBand(
  tasks: Task[],
  runs: WorkRun[],
  day: string,
  groupOfCategory: (category: string) => string,
  now = Date.now(),
): DaySegment[] {
  return timed(entriesInRange(tasks, runs, day, day, groupOfCategory, now))
}
