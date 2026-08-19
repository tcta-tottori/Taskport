import { dayKey, isoAt, toMinutes } from './date'
import { occurrenceKey, planEnd } from './plans'
import { ulid } from './ulid'
import type { PlanOccurrence, PlanRun, Task } from '../types'

/* =========================================================
 * 予定の実行（開始・一時停止・終了）
 *
 * 【どちらが実績を持つか】
 *   タスク … 台帳が持つ（`Task.startedAt` / `Task.actualMin`。`lib/worklog.ts`）
 *   予定   … ここが持つ（予定はタスクではないので台帳に置けない）
 * 実行中の判定も同じ分担にする。1つの仕事が2か所に記録されないようにするため、
 * ここでタスクを扱わない。
 *
 * 区間の並びで持つので、一時停止は区間を閉じるだけ、再開は次の区間を開くだけ。
 * 合計は足し算で出る。記録は書き換えず、消したいときは記録ごと消す。
 * =======================================================*/

/** 開いたままの区間の位置。無ければ -1 */
function openSegment(run: PlanRun): number {
  return run.segments.findIndex((s) => s.end === null)
}

/** 実行した秒数。動いている区間は now までを数える。 */
export function runSeconds(run: PlanRun, nowMs: number = Date.now()): number {
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
export function runMinutes(run: PlanRun, nowMs: number = Date.now()): number {
  return Math.round(runSeconds(run, nowMs) / 60)
}

/** その日の予定ぶんの実働（分） */
export function dayMinutes(runs: PlanRun[], day: string, nowMs: number = Date.now()): number {
  return runs.filter((r) => r.day === day).reduce((s, r) => s + runMinutes(r, nowMs), 0)
}

/** その回に紐づく記録。無ければ null */
export function runOf(runs: PlanRun[], planKey: string): PlanRun | null {
  return runs.find((r) => r.planKey === planKey) ?? null
}

/** 動いているものと止めてあるもの（終えたものは除く）。動いているほうが先。 */
export function activeRuns(runs: PlanRun[]): PlanRun[] {
  return runs
    .filter((r) => r.state !== 'done')
    .sort((a, b) => (a.state === b.state ? (a.id < b.id ? 1 : -1) : a.state === 'running' ? -1 : 1))
}

/* ---------------------------------------------------------
 * 状態を変える。どれも新しいオブジェクトを返す（元は触らない）。
 * ------------------------------------------------------- */

/** 予定の1回ぶんから記録を起こす */
export function beginRun(
  occ: PlanOccurrence,
  opts: { auto: boolean; startedAt?: string },
): PlanRun {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    planKey: occ.key,
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
export function pauseRun(run: PlanRun, at: string = new Date().toISOString()): PlanRun {
  const i = openSegment(run)
  if (i < 0) return { ...run, state: 'paused', updatedAt: at }
  const segments = run.segments.map((s, j) => (j === i ? { ...s, end: at } : s))
  return { ...run, segments, state: 'paused', updatedAt: at }
}

/** 続きから始める。新しい区間を開く（前の区間は動かさない）。 */
export function resumeRun(run: PlanRun, at: string = new Date().toISOString()): PlanRun {
  if (run.state === 'running') return run
  return { ...run, segments: [...run.segments, { start: at, end: null }], state: 'running', updatedAt: at }
}

/** 終える。動いている区間があれば閉じる。 */
export function finishRun(run: PlanRun, at: string = new Date().toISOString()): PlanRun {
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
  /** 保存してある予定の記録（新しい日ぶん） */
  runs: PlanRun[]
  /** いまの時刻（ミリ秒）。経過時間の計算に使う */
  nowMs: number
  startPlan: (occ: PlanOccurrence) => void
  pause: (run: PlanRun) => void
  resume: (run: PlanRun) => void
  finish: (run: PlanRun) => void
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
  save: PlanRun[]
  /** 画面に出す知らせ。何も起きなければ空 */
  notes: string[]
}

export function autoTrack(
  occurrences: PlanOccurrence[],
  runs: PlanRun[],
  today: string,
  nowMin: number,
): AutoTrackResult {
  const save: PlanRun[] = []
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
