import { ulid } from './ulid'
import { measuredMin } from './worklog'
import { runSeconds } from './runs'
import { taskMinutes } from './workday'
import type { Job, Plan, Task, WorkRun } from '../types'

/* =========================================================
 * 工数（案件ごとの時間）
 *
 * 区分（categories）が「何をしたか」なら、案件（Job）は「何のためにしたか」。
 * 同じ伝票処理でも、A社の立ち上げぶんと定常ぶんを分けて数えたい、が実際に起きる。
 *
 * 【数え方】
 *   合計   … 台帳の実績（`Task.actualMin`）＋ 予定の実行ログ。**押して測った時間だけ**
 *   期間   … 実行ログの区間から。ログは 90日ぶんしか残らないので、そのことを画面に書く
 *   見込み … タスクの `estimateMin` の合計（案件の見積 `plannedMin` とは別物）
 *
 * 見込みと実績を1つの数字に混ぜない（CLAUDE.md §3.3）。
 * 稼働の集計と同じく、**数えるのは押して測った時間だけ**にする。
 * =======================================================*/

/** 空の案件。作る画面の下敷き */
export function emptyJob(): Job {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    name: '',
    code: '',
    client: '',
    plannedMin: 0,
    due: null,
    closed: false,
    note: '',
    createdAt: now,
    updatedAt: now,
  }
}

/** 案件なしをまとめる鍵 */
export const NO_JOB = ''

export interface JobTotals {
  /** 押して測った実績（分）。タスクの台帳＋予定の実行ログ */
  actualMin: number
  /** そのうち予定（打合せなど）ぶん */
  planMin: number
  /** まだ終わっていないタスクの見込み（分） */
  restMin: number
  /** 紐づくタスクの件数 */
  taskCount: number
  /** そのうち未完了 */
  openCount: number
}

const EMPTY: JobTotals = { actualMin: 0, planMin: 0, restMin: 0, taskCount: 0, openCount: 0 }

/**
 * 案件ごとの合計を一度に作る。
 * 画面は案件の数だけ引くので、1件ずつ数え直さず Map にして返す。
 */
export function totalsByJob(
  tasks: Task[],
  plans: Plan[],
  runs: WorkRun[],
  defaultEstimateMin: number,
  now = Date.now(),
): Map<string, JobTotals> {
  const out = new Map<string, JobTotals>()
  const bump = (key: string, patch: Partial<JobTotals>) => {
    const cur = out.get(key) ?? { ...EMPTY }
    out.set(key, {
      actualMin: cur.actualMin + (patch.actualMin ?? 0),
      planMin: cur.planMin + (patch.planMin ?? 0),
      restMin: cur.restMin + (patch.restMin ?? 0),
      taskCount: cur.taskCount + (patch.taskCount ?? 0),
      openCount: cur.openCount + (patch.openCount ?? 0),
    })
  }

  for (const t of tasks) {
    const key = t.jobId ?? NO_JOB
    bump(key, {
      actualMin: measuredMin(t, now),
      taskCount: 1,
      openCount: t.status === 'open' ? 1 : 0,
      restMin: t.status === 'open' ? taskMinutes(t, defaultEstimateMin) : 0,
    })
  }

  // 予定ぶんは実行ログから。予定そのものは台帳に入らないので、
  // 「入れただけの予定」は数えない（押して動かした区間だけ）。
  //
  // **秒で足してから分にする。** 1件ずつ分に丸めると、短い区間が全部 0分になり、
  // 台帳側の数え方（20秒以上は1分）と食い違う。
  const jobOfPlan = new Map(plans.map((p) => [p.id, p.jobId ?? NO_JOB]))
  const planSec = new Map<string, number>()
  for (const r of runs) {
    if (r.kind !== 'plan') continue
    const planId = r.targetId.split(':')[0]
    const key = jobOfPlan.get(planId)
    if (!key) continue
    planSec.set(key, (planSec.get(key) ?? 0) + runSeconds(r, now))
  }
  for (const [key, sec] of planSec) {
    const min = sec >= 20 ? Math.max(1, Math.round(sec / 60)) : 0
    if (min > 0) bump(key, { actualMin: min, planMin: min })
  }

  return out
}

/** 期間（from〜to、両端を含む）に押して測った分。実行ログだけで数える */
export function rangeMinutesByJob(
  tasks: Task[],
  plans: Plan[],
  runs: WorkRun[],
  from: string,
  to: string,
  now = Date.now(),
): Map<string, number> {
  const jobOfTask = new Map(tasks.map((t) => [t.id, t.jobId ?? NO_JOB]))
  const jobOfPlan = new Map(plans.map((p) => [p.id, p.jobId ?? NO_JOB]))
  // ここも秒で足してから分にする（1件ずつ丸めると短い区間が消える）
  const sec = new Map<string, number>()
  for (const r of runs) {
    if (r.day < from || r.day > to) continue
    const key =
      r.kind === 'task'
        ? jobOfTask.get(r.targetId)
        : jobOfPlan.get(r.targetId.split(':')[0])
    if (key === undefined) continue
    sec.set(key, (sec.get(key) ?? 0) + runSeconds(r, now))
  }
  const out = new Map<string, number>()
  for (const [key, s] of sec) {
    const min = s >= 20 ? Math.max(1, Math.round(s / 60)) : 0
    if (min > 0) out.set(key, min)
  }
  return out
}

/** 案件の進み具合。見積が入っていないときは null（推測で埋めない） */
export function jobRatio(job: Job, totals: JobTotals): number | null {
  if (job.plannedMin <= 0) return null
  return totals.actualMin / job.plannedMin
}

/** 見出しに出す名前。管理番号があれば頭に付ける */
export function jobLabel(job: Job): string {
  return job.code ? `${job.code} ${job.name}` : job.name
}

/** 一覧の並び。開いている案件が先、そのあと更新の新しい順 */
export function sortJobs(list: Job[]): Job[] {
  return [...list].sort((a, b) => {
    if (a.closed !== b.closed) return a.closed ? 1 : -1
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1
    if (!!a.due !== !!b.due) return a.due ? -1 : 1
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
}

/** 案件を引く。無ければ null */
export function jobOf(list: Job[], id: string | null): Job | null {
  if (!id) return null
  return list.find((j) => j.id === id) ?? null
}
