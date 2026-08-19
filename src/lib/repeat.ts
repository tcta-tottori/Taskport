import { addDaysKey, diffDays, parseDayKey, dayKey, weekdayOf } from './date'
import { ulid } from './ulid'
import { isWorkDay } from './workday'
import type { Repeat, RepeatUnit, Task, WorkCalendar, WorkHours } from '../types'

/* =========================================================
 * 繰り返し
 *
 * 定例（日報・週次会議・棚卸・月初集計）を毎回打ち直さずに済ませる。
 *
 * 作り方は「完了にしたときに次回ぶんを1件だけ作る」。
 * 先の分をまとめて作らないのは、
 *   - 一覧が未来のタスクで埋まると、いま何をやるかが見えなくなる
 *   - 予定が変わったとき、作り置いた分を全部直すことになる
 * ため。1件ずつなら、やめたければその1件を消せば終わる。
 * =======================================================*/

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

export const REPEAT_UNITS: { key: RepeatUnit; label: string }[] = [
  { key: 'day', label: '毎日' },
  { key: 'workday', label: '稼働日ごと' },
  { key: 'week', label: '毎週' },
  { key: 'month', label: '毎月おなじ日' },
  { key: 'monthEnd', label: '毎月末' },
]

export function emptyRepeat(unit: RepeatUnit = 'week'): Repeat {
  return { unit, weekdays: [], until: null }
}

/** 「毎週 月・木」「毎月末」。一覧のチップと確認画面に出す。 */
export function repeatLabel(repeat: Repeat | null): string {
  if (!repeat) return ''
  const base = REPEAT_UNITS.find((u) => u.key === repeat.unit)?.label ?? ''
  if (repeat.unit === 'week' && repeat.weekdays.length > 0) {
    const days = [...repeat.weekdays].sort().map((d) => WEEKDAY_JA[d]).join('・')
    return `毎週 ${days}`
  }
  return base
}

/** その月の末日 */
function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

/** 月を n か月進める。日は、進めた先に無ければその月の末日に寄せる。 */
function addMonthsKey(key: string, n: number, keepDay: number): string {
  const d = parseDayKey(key)
  const y = d.getFullYear()
  const m = d.getMonth() + n
  const target = new Date(y, m, 1, 12, 0, 0, 0)
  const last = lastDayOfMonth(target.getFullYear(), target.getMonth())
  target.setDate(Math.min(keepDay, last))
  return dayKey(target)
}

/** 稼働の判定に使う設定。会社カレンダーがあれば祝日・一斉有給・土曜出勤も見る。 */
export interface WorkRule {
  workHours: WorkHours
  workCalendar?: WorkCalendar | null
}

/**
 * from の翌日以降で、条件に合う最初の日を1つ返す。
 *
 * タスクは「完了にしたときに次の1件を作る」ので普段は `nextDue` から使うが、
 * 予定（Plan）は作り置きせず画面に出すときに展開するため、
 * 1回ぶんずつ進める道具としてそのまま外へ出してある（`stepDay`）。
 */
function step(from: string, repeat: Repeat, rule: WorkRule): string {
  switch (repeat.unit) {
    case 'day':
      return addDaysKey(from, 1)

    case 'workday': {
      let d = addDaysKey(from, 1)
      // 連休や年末年始をまたぐことがあるので、少し広めに見る
      for (let i = 0; i < 40; i++) {
        if (isWorkDay(d, rule.workHours, rule.workCalendar)) return d
        d = addDaysKey(d, 1)
      }
      return d
    }

    case 'week': {
      const set = repeat.weekdays.length > 0 ? repeat.weekdays : [weekdayOf(from)]
      let d = addDaysKey(from, 1)
      for (let i = 0; i < 7; i++) {
        if (set.includes(weekdayOf(d))) return d
        d = addDaysKey(d, 1)
      }
      return d
    }

    case 'month': {
      const day = parseDayKey(from).getDate()
      return addMonthsKey(from, 1, day)
    }

    case 'monthEnd': {
      const d = parseDayKey(from)
      // 末日から1か月進めるので、まず翌月の1日へ寄せてから末日を取る
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12, 0, 0, 0)
      next.setDate(lastDayOfMonth(next.getFullYear(), next.getMonth()))
      return dayKey(next)
    }
  }
}

/**
 * 次回の期限。
 *
 * 必ず1回は進めてから、今日より後になるまで進める。
 *   - 期限どおりに終えた   … 素直に次の回
 *   - 期限を過ぎて終えた   … 過ぎた分は飛ばして、次に来る回
 *   - 期限より早く終えた   … 前倒しした回は消費したものとして、その次の回
 * until を越えたら null（もう作らない）。
 */
export function nextDue(
  due: string,
  repeat: Repeat,
  today: string,
  rule: WorkRule,
): string | null {
  let d = step(due, repeat, rule)
  // 進めても今日以前なら、今日より後になるまで送る。
  // 月単位でも 400 回あれば 30 年ぶん進むので、無限には回らない。
  for (let i = 0; i < 400 && diffDays(d, today) <= 0; i++) {
    d = step(d, repeat, rule)
  }
  if (repeat.until && diffDays(d, repeat.until) > 0) return null
  return d
}

/**
 * 完了にしたタスクから、次回ぶんの新しいタスクを作る。
 * 繰り返しでない・期限がない・until を越えたときは null。
 *
 * 完了したほうには手を触れない（履歴として残す）。
 */
export function nextOccurrence(task: Task, today: string, rule: WorkRule): Task | null {
  if (!task.repeat || !task.due) return null
  const due = nextDue(task.due, task.repeat, today, rule)
  if (!due) return null
  const now = new Date().toISOString()
  return {
    ...task,
    id: ulid(),
    due,
    status: 'open',
    doneAt: null,
    // 手順は毎回やり直すものなので、チェックを外して持ち越す
    subtasks: task.subtasks.map((s) => ({ ...s, id: ulid(), done: false })),
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 繰り返しを1回ぶん進める。予定（Plan）の展開に使う。
 * `nextDue` と違い「今日より後」までは送らない（過去の回も並べたいため）。
 */
export function stepDay(from: string, repeat: Repeat, rule: WorkRule): string {
  return step(from, repeat, rule)
}
