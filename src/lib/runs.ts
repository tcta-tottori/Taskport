import { dayKey, isoAt, toMinutes } from './date'
import { occurrenceKey, planEnd } from './plans'
import { ulid } from './ulid'
import { primaryCategory } from './workCategories'
import type { PlanOccurrence, RunKind, Task, WorkRun } from '../types'

/* =========================================================
 * 実行（開始・一時停止・終了）
 *
 * 「いま何に手を付けているか」を持つ。見込み時間（estimateMin）とは
 * 別物で、こちらは**実績**。区間の並びで持ち、一時停止は区間を閉じるだけ。
 *
 * 同時に何本でも走らせられる。電話を受けながら伝票を打つ、という
 * 使い方が実際に起きるので、1本に絞ると使えなくなる。
 * 走っているものを画面の一番上に、次にやるものをその下に出す。
 *
 * 記録は**書き換えない**。止めた区間の時刻を後から動かすと、
 * 実績が実績でなくなる（消したいときは記録ごと消す）。
 * =======================================================*/

export function isRunning(run: WorkRun): boolean {
  return run.state === 'running'
}

/** 動いている区間（開いたままの区間）があるか */
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

/** その日の実働合計（分） */
export function dayMinutes(runs: WorkRun[], day: string, nowMs: number = Date.now()): number {
  return runs.filter((r) => r.day === day).reduce((s, r) => s + runMinutes(r, nowMs), 0)
}

/** 対象（タスクID／予定の回の鍵）に紐づく記録。無ければ null */
export function runOf(runs: WorkRun[], targetId: string): WorkRun | null {
  return runs.find((r) => r.targetId === targetId) ?? null
}

/** 動いているものと止めてあるもの（終えたものは除く）。開始が新しい順。 */
export function activeRuns(runs: WorkRun[]): WorkRun[] {
  return runs
    .filter((r) => r.state !== 'done')
    .sort((a, b) => (a.state === b.state ? (a.id < b.id ? 1 : -1) : a.state === 'running' ? -1 : 1))
}

/* ---------------------------------------------------------
 * 状態を変える。どれも新しいオブジェクトを返す（元は触らない）。
 * ------------------------------------------------------- */

export function beginRun(input: {
  kind: RunKind
  targetId: string
  title: string
  categories: string[]
  day?: string
  auto?: boolean
  /** 開始時刻を指定する（予定の自動計上で、始まりに遡って入れるとき） */
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

/** タスクから記録を起こす */
export function runForTask(task: Task, day: string): WorkRun {
  return beginRun({
    kind: 'task',
    targetId: task.id,
    title: task.title,
    categories: task.categories,
    day,
  })
}

/** 予定の1回ぶんから記録を起こす */
export function runForPlan(occ: PlanOccurrence, opts: { auto: boolean; startedAt?: string }): WorkRun {
  return beginRun({
    kind: 'plan',
    targetId: occ.key,
    title: occ.plan.title,
    categories: occ.plan.categories,
    day: occ.day,
    auto: opts.auto,
    startedAt: opts.startedAt,
  })
}

/** 記録の主区分（時間を積むのは先頭だけ。全部に積むと合計が実時間を超える） */
export function runCategory(run: WorkRun): string {
  return primaryCategory(run.categories)
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
        save.push(runForPlan(occ, { auto: true, startedAt: isoAt(occ.day, plan.startTime) }))
        notes.push(`「${plan.title}」を始めました（自動）`)
      }
      continue
    }

    // 予定は終わっている
    if (!existing) {
      // 閉じている間に過ぎた分。始まりと終わりを入れて、終わった記録にする
      const run = runForPlan(occ, { auto: true, startedAt: isoAt(occ.day, plan.startTime) })
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

/* ---------------------------------------------------------
 * 画面から実行を操作するための受け渡し
 *
 * カレンダー・スケジュール・実行の3画面が同じ操作を持つので、
 * 引数の形をここで1つに決めておく（画面ごとに名前が変わると迷う）。
 * ここは型だけで、React には依存しない。
 * ------------------------------------------------------- */

export interface RunBox {
  /** 保存してある記録（新しい日ぶん） */
  runs: WorkRun[]
  /** いまの時刻（ミリ秒）。経過時間の計算に使う */
  nowMs: number
  startTask: (task: Task) => void
  startPlan: (occ: PlanOccurrence) => void
  pause: (run: WorkRun) => void
  resume: (run: WorkRun) => void
  finish: (run: WorkRun) => void
}
