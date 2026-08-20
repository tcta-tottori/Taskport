import { dayKey, isoAt, toMinutes } from './date'
import { occurrenceKey, planEnd } from './plans'
import { ulid } from './ulid'
import type { PlanOccurrence, RunKind, Task, WorkRun } from '../types'

/* =========================================================
 * 実行（開始・一時停止・終了）
 *
 * 【何をどこが持つか】
 *   区間（いつからいつまで） … ここ。タスクも予定も同じ形で持つ
 *   合計（かかった時間）     … タスクは台帳の `actualMin`（`lib/worklog.ts`）、
 *                              予定はここの区間の合計
 *   実行中の印               … タスクは台帳の `startedAt`、予定は区間が開いているか
 *
 * 台帳の `startedAt` は止めると消えるので、それだけだと「何時にやったか」が
 * 残らない。時間帯の色分け（分析）と日報の枠決めに要るので、区間はここに積む。
 *
 * 一時停止は区間を閉じるだけ、再開は次の区間を開くだけ。合計は足し算で出る。
 * 記録は書き換えず、消したいときは記録ごと消す。
 * =======================================================*/

/** 開いたままの区間の位置。無ければ -1 */
function openSegment(run: WorkRun): number {
  return run.segments.findIndex((s) => s.end === null)
}

/** 実行した秒数。動いている区間は now までを数える。 */
export function runSeconds(run: WorkRun, nowMs: number = Date.now()): number {
  let ms = 0
  for (const s of run.segments) {
    const from = new Date(s.start).getTime()
    if (Number.isNaN(from)) continue
    const to = s.end ? new Date(s.end).getTime() : nowMs
    if (!Number.isNaN(to) && to > from) ms += to - from
  }
  return Math.floor(ms / 1000)
}

/** 実行した分。稼働の集計に使う。 */
export function runMinutes(run: WorkRun, nowMs: number = Date.now()): number {
  return Math.round(runSeconds(run, nowMs) / 60)
}

/** その日の予定ぶんの実働（分） */
export function dayMinutes(runs: WorkRun[], day: string, nowMs: number = Date.now()): number {
  return runs.filter((r) => r.day === day).reduce((s, r) => s + runMinutes(r, nowMs), 0)
}

/** その対象に紐づく記録。無ければ null（同じ日に1本だけ持つ） */
export function runOf(runs: WorkRun[], targetId: string): WorkRun | null {
  return runs.find((r) => r.targetId === targetId) ?? null
}

/** その対象・その日の記録すべて（日をまたぐと別の記録になる） */
export function runsOf(runs: WorkRun[], targetId: string, day: string): WorkRun[] {
  return runs.filter((r) => r.targetId === targetId && r.day === day)
}

/** その対象・その日に実際に測れた分 */
export function measuredMinutesOf(runs: WorkRun[], targetId: string, day: string, nowMs = Date.now()): number {
  const sec = runsOf(runs, targetId, day).reduce((s, r) => s + runSeconds(r, nowMs), 0)
  return Math.floor(sec / 60)
}

/** 動いているものと止めてあるもの（終えたものは除く）。動いているほうが先。 */
export function activeRuns(runs: WorkRun[]): WorkRun[] {
  return runs
    .filter((r) => r.state !== 'done')
    .sort((a, b) => (a.state === b.state ? (a.id < b.id ? 1 : -1) : a.state === 'running' ? -1 : 1))
}

/* ---------------------------------------------------------
 * 状態を変える。どれも新しいオブジェクトを返す（元は触らない）。
 * ------------------------------------------------------- */

/** 記録を1本起こす（タスク・予定の共通の入口） */
export function newRun(input: {
  kind: RunKind
  targetId: string
  title: string
  categories: string[]
  day?: string
  auto?: boolean
  startedAt?: string
}): WorkRun {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    kind: input.kind,
    targetId: input.targetId,
    title: input.title.trim() || '（件名なし）',
    categories: [...input.categories],
    day: input.day ?? dayKey(),
    segments: [{ start: input.startedAt ?? now, end: null }],
    state: 'running',
    auto: input.auto === true,
    createdAt: now,
    updatedAt: now,
  }
}

/** タスクから記録を起こす */
export function runForTask(task: Task, day: string): WorkRun {
  return newRun({
    kind: 'task',
    targetId: task.id,
    title: task.title,
    categories: task.categories,
    day,
  })
}

/** 予定の1回ぶんから記録を起こす */
export function beginRun(
  occ: PlanOccurrence,
  opts: { auto: boolean; startedAt?: string },
): WorkRun {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    kind: 'plan',
    targetId: occ.key,
    title: occ.plan.title.trim() || '（件名なし）',
    categories: [...occ.plan.categories],
    day: occ.day || dayKey(),
    segments: [{ start: opts.startedAt ?? now, end: null }],
    state: 'running',
    auto: opts.auto,
    createdAt: now,
    updatedAt: now,
  }
}

/** 止める。動いていなければそのまま返す。 */
export function pauseRun(run: WorkRun, at: string = new Date().toISOString()): WorkRun {
  const i = openSegment(run)
  if (i < 0) return { ...run, state: 'paused', updatedAt: at }
  const segments = run.segments.map((s, j) => (j === i ? { ...s, end: at } : s))
  return { ...run, segments, state: 'paused', updatedAt: at }
}

/** 続きから始める。新しい区間を開く（前の区間は動かさない）。 */
export function resumeRun(run: WorkRun, at: string = new Date().toISOString()): WorkRun {
  if (run.state === 'running') return run
  return { ...run, segments: [...run.segments, { start: at, end: null }], state: 'running', updatedAt: at }
}

/** 終える。動いている区間があれば閉じる。 */
export function finishRun(run: WorkRun, at: string = new Date().toISOString()): WorkRun {
  const i = openSegment(run)
  const segments = i < 0 ? run.segments : run.segments.map((s, j) => (j === i ? { ...s, end: at } : s))
  return { ...run, segments, state: 'done', updatedAt: at }
}

/* ---------------------------------------------------------
 * 画面から実行を操作するための受け渡し
 *
 * カレンダー・スケジュール・実行の3画面が同じ操作を持つので、
 * 引数の形をここで1つに決めておく（画面ごとに名前が変わると迷う）。
 * タスクのほうは台帳を直すので `onToggleRunning(task)` を別に渡す。
 * ここは型だけで、React には依存しない。
 * ------------------------------------------------------- */

export interface RunBox {
  /** 保存してある実行の記録（新しい日ぶん。タスクと予定の両方） */
  runs: WorkRun[]
  /** いまの時刻（ミリ秒）。経過時間の計算に使う */
  nowMs: number
  startPlan: (occ: PlanOccurrence) => void
  pause: (run: WorkRun) => void
  resume: (run: WorkRun) => void
  finish: (run: WorkRun) => void
  /** タスクの手を付ける／止める（実績は台帳が持つ） */
  toggleTask: (task: Task) => void
}

/* ---------------------------------------------------------
 * 予定の自動計上
 *
 * 「自動」にした予定は、開始時刻で実行が始まり、終了時刻で終わる。
 * アプリを閉じている間に時間が過ぎていたときは、**その日ぶんだけ**
 * 開始〜終了の区間を入れて終わった記録にする（会議には出ていたのに
 * 記録だけ空になる、を防ぐ）。前の日まで遡って作ることはしない
 * （出たかどうか分からないものを実績として書かない）。
 *
 * 手で止めた記録・終えた記録には触らない。人の操作が常に優先。
 * ------------------------------------------------------- */

export interface AutoTrackResult {
  /** 保存する記録（新規・更新の両方） */
  save: WorkRun[]
  /** 画面に出す知らせ。何も起きなければ空 */
  notes: string[]
}

export function autoTrack(
  occurrences: PlanOccurrence[],
  runs: WorkRun[],
  today: string,
  nowMin: number,
): AutoTrackResult {
  const save: WorkRun[] = []
  const notes: string[] = []
  for (const occ of occurrences) {
    const plan = occ.plan
    if (!plan.autoTrack || plan.allDay || !plan.startTime || occ.day !== today) continue
    const from = toMinutes(plan.startTime)
    const endTime = planEnd(plan)
    const to = endTime ? toMinutes(endTime) : null
    if (from === null || to === null) continue

    const key = occurrenceKey(plan.id, occ.day)
    const existing = runOf(runs, key)

    if (nowMin < from) continue

    if (nowMin < to) {
      // 予定の最中。まだ記録が無ければ、始まった時刻から始める
      if (!existing) {
        save.push(beginRun(occ, { auto: true, startedAt: isoAt(occ.day, plan.startTime) }))
        notes.push(`「${plan.title}」を始めました（自動）`)
      }
      continue
    }

    // 予定は終わっている
    if (!existing) {
      // 閉じている間に過ぎた分。始まりと終わりを入れて、終わった記録にする
      const run = beginRun(occ, { auto: true, startedAt: isoAt(occ.day, plan.startTime) })
      save.push(finishRun(run, isoAt(occ.day, endTime as string)))
      continue
    }
    if (existing.state === 'running') {
      save.push(finishRun(existing, isoAt(occ.day, endTime as string)))
      notes.push(`「${plan.title}」を終えました（自動）`)
    }
  }
  return { save, notes }
}
