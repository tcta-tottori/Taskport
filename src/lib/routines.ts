import { addDaysKey } from './date'
import { entriesInRange } from './worklog'
import type { Task, WorkRun } from '../types'

/* =========================================================
 * よくやる業務
 *
 * 同じ仕事は何度も回ってくる（発注データを送る・納期の返事・伝票の入力）。
 * そのたびに台帳から探すか、1件立て直すかをしていたので、
 * **実行の画面に「押せばすぐ始まる」形で並べる**（v1.31.0。利用者の指示）。
 *
 * 【何をもって「よくやる」とするか】
 * 数えるのは**実際に手を動かした記録だけ**（実行の記録＋あとから足した記録）。
 * 素は分析と同じ `worklog.entriesInRange` ひとつで、ここだけ別の数え方をしない。
 *
 * 回数ではなく**やった日の数**で並べる。同じ日に5回押した1件より、
 * 5日にわたって1回ずつやった1件のほうが「よくやる業務」に近い。
 *
 * 予定（会議・来客）は数えない。ここから立てるのはタスクなので、
 * 予定を混ぜると台帳に予定が生えることになる（CLAUDE.md §3.3）。
 * =======================================================*/

/** 何日ぶんの記録から決めるか。実行の記録は90日ぶんしか残らない */
export const ROUTINE_DAYS = 60

export interface Routine {
  /** 件名をそろえた鍵 */
  key: string
  title: string
  /** 主区分。付いていなければ空 */
  category: string
  /** やった日の数（同じ日に何度押しても1日） */
  days: number
  /** 押して動かした回数 */
  count: number
  /** 最後にやった日 "YYYY-MM-DD" */
  lastDay: string
  /** 1日あたりの平均（分）。**見込みの欄には入れない**（実績は実績のまま出す） */
  avgMin: number
  /**
   * すぐ始められる台帳の1件。同じ件名の未完了があればそのID。
   * 無ければ null（押したときに1件立てる）。
   */
  taskId: string | null
}

/** 同じ仕事とみなす鍵。記憶したタスク（`lib/templates.ts`）と同じ揃え方にする */
function keyOf(title: string): string {
  return title.trim().normalize('NFKC').toLowerCase()
}

/**
 * よくやる業務を上から返す。
 *
 * 同じ件名の未完了が台帳にあるときは、それを始める相手（`taskId`）にする。
 * **いま動かしている最中のものは返さない**（実行中の面に出ているので、
 * ここに並べると押して止めてしまう）。
 */
export function topRoutines(
  tasks: Task[],
  runs: WorkRun[],
  today: string,
  limit = 3,
  days = ROUTINE_DAYS,
  now = Date.now(),
): Routine[] {
  const from = addDaysKey(today, -days)
  const acc = new Map<
    string,
    { title: string; category: string; dayKeys: Set<string>; count: number; minutes: number; lastDay: string }
  >()

  for (const e of entriesInRange(tasks, runs, from, today, () => '', now)) {
    if (e.kind !== 'task') continue
    const title = e.title.trim()
    if (!title) continue
    const key = keyOf(title)
    const cur = acc.get(key)
    if (cur) {
      cur.dayKeys.add(e.day)
      cur.count++
      cur.minutes += e.minutes
      if (e.day >= cur.lastDay) {
        cur.lastDay = e.day
        // 区分は最後にやったときのものを出す（付け替えたら新しいほうに従う）
        if (e.category) cur.category = e.category
      }
    } else {
      acc.set(key, {
        title,
        category: e.category,
        dayKeys: new Set([e.day]),
        count: 1,
        minutes: e.minutes,
        lastDay: e.day,
      })
    }
  }

  // 台帳の未完了（同じ件名）。始める相手にする。動かしている最中のものは省く
  const openByKey = new Map<string, Task>()
  const running = new Set<string>()
  for (const t of tasks) {
    if (t.status !== 'open') continue
    const key = keyOf(t.title)
    if (t.startedAt) {
      running.add(key)
      continue
    }
    const cur = openByKey.get(key)
    // 期限の早いほうを先に始める。期限なしは後ろ
    if (!cur || (t.due ?? '9999') < (cur.due ?? '9999')) openByKey.set(key, t)
  }

  return [...acc.entries()]
    .filter(([key]) => !running.has(key))
    .map(([key, v]) => ({
      key,
      title: v.title,
      category: v.category,
      days: v.dayKeys.size,
      count: v.count,
      lastDay: v.lastDay,
      avgMin: Math.round(v.minutes / v.dayKeys.size),
      taskId: openByKey.get(key)?.id ?? null,
    }))
    // 2回以上やったものだけ。1回きりの仕事は「よくやる」ではない
    .filter((r) => r.days >= 2)
    .sort((a, b) => b.days - a.days || b.count - a.count || b.lastDay.localeCompare(a.lastDay))
    .slice(0, Math.max(0, limit))
}
