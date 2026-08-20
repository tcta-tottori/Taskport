import { isDayKey, isTimeKey } from './date'
import { ulid } from './ulid'
import { cleanCategories, normalizeGroups } from './workCategories'
import { PRIORITIES, type Job, type Plan, type Priority, type Repeat, type RepeatUnit, type Settings, type Source, type Subtask, type Task, type TimeboxKey } from '../types'

/* =========================================================
 * JSON バックアップ（端末故障・キャッシュ削除への備え）
 *
 * 端末内にしかデータが無いので、書き出しと取り込みは必須機能。
 * 取り込み時は形を検証し、壊れたレコードは黙って捨てずに件数で知らせる。
 * =======================================================*/

export interface BackupFile {
  app: 'taskport'
  version: 1
  exportedAt: string
  tasks: Task[]
  /** 予定（打合せ・固定の業務）。v1.14.0 から。古いファイルには入っていない */
  plans?: Plan[]
  /** 案件（工数の単位）。v1.25.0 から */
  jobs?: Job[]
  settings?: Settings
}

/**
 * 書き出す中身。
 * **実行ログ（開始・終了の記録）は入れない。** あれはその端末で動かした実績で、
 * 別の端末へ移して意味のあるものではない（移すと同じ時間が二重に立つ）。
 */
export function makeBackup(
  tasks: Task[],
  settings: Settings,
  plans: Plan[] = [],
  jobs: Job[] = [],
): string {
  const payload: BackupFile = {
    app: 'taskport',
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    plans,
    jobs,
    settings,
  }
  return JSON.stringify(payload, null, 2)
}

const SOURCES: Source[] = ['voice', 'text', 'form', 'share', 'calendar']
const REPEAT_KINDS: RepeatUnit[] = ['day', 'workday', 'week', 'month', 'monthEnd']
const TIMEBOXES: TimeboxKey[] = ['am1', 'am2', 'pm1', 'pm2', 'out']

/** 取り込んだ手順。件名の無いものは落とす。 */
function toSubtasks(raw: unknown): Subtask[] {
  if (!Array.isArray(raw)) return []
  const out: Subtask[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) continue
    out.push({ id: typeof o.id === 'string' && o.id ? o.id : ulid(), title, done: o.done === true })
  }
  return out
}

/** 取り込んだ繰り返し設定。形が合わなければ捨てる（誤って毎日増え続けるより安全） */
function toRepeat(raw: unknown): Repeat | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (!REPEAT_KINDS.includes(o.unit as RepeatUnit)) return null
  const weekdays = Array.isArray(o.weekdays)
    ? o.weekdays.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
    : []
  return {
    unit: o.unit as RepeatUnit,
    weekdays,
    until: isDayKey(o.until) ? o.until : null,
  }
}

function toTask(raw: unknown): Task | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!id || !title) return null
  const now = new Date().toISOString()
  return {
    id,
    title,
    note: typeof o.note === 'string' ? o.note : '',
    jobId: typeof o.jobId === 'string' ? o.jobId : null,
    due: isDayKey(o.due) ? o.due : null,
    dueTime: isTimeKey(o.dueTime) ? o.dueTime : null,
    estimateMin: typeof o.estimateMin === 'number' && o.estimateMin > 0 ? Math.round(o.estimateMin) : null,
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : null,
    actualMin: typeof o.actualMin === 'number' && o.actualMin > 0 ? Math.round(o.actualMin) : null,
    priority: PRIORITIES.includes(o.priority as Priority) ? (o.priority as Priority) : 'mid',
    // v1.10 以前は区分が1つ（category）だった。読めるようにしておく
    categories: Array.isArray(o.categories)
      ? cleanCategories(o.categories.filter((c): c is string => typeof c === 'string'))
      : typeof o.category === 'string' && o.category.trim()
        ? [o.category.trim()]
        : [],
    subtasks: toSubtasks(o.subtasks),
    timebox: TIMEBOXES.includes(o.timebox as TimeboxKey) ? (o.timebox as TimeboxKey) : null,
    // 期限が無くても繰り返しは持てる（v1.14.0）
    repeat: toRepeat(o.repeat),
    status: o.status === 'done' ? 'done' : 'open',
    source: SOURCES.includes(o.source as Source) ? (o.source as Source) : 'form',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
    doneAt: typeof o.doneAt === 'string' ? o.doneAt : null,
  }
}

/** 取り込んだ予定。件名か日付が無いものは捨てる（日付が無いと展開できない） */
function toPlan(raw: unknown): Plan | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!id || !title || !isDayKey(o.day)) return null
  const now = new Date().toISOString()
  const startTime = isTimeKey(o.startTime) ? o.startTime : null
  return {
    id,
    title,
    note: typeof o.note === 'string' ? o.note : '',
    place: typeof o.place === 'string' ? o.place : '',
    jobId: typeof o.jobId === 'string' ? o.jobId : null,
    day: o.day,
    startTime,
    endTime: isTimeKey(o.endTime) ? o.endTime : null,
    allDay: o.allDay === true || !startTime,
    categories: Array.isArray(o.categories)
      ? cleanCategories(o.categories.filter((c): c is string => typeof c === 'string'))
      : [],
    autoTrack: o.autoTrack !== false,
    repeat: toRepeat(o.repeat),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
  }
}

/** 案件。名前が無いものは捨てる（何の工数か分からないものを入れない） */
function toJob(raw: unknown): Job | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!id || !name) return null
  const now = new Date().toISOString()
  return {
    id,
    name,
    code: typeof o.code === 'string' ? o.code : '',
    client: typeof o.client === 'string' ? o.client : '',
    plannedMin: typeof o.plannedMin === 'number' && o.plannedMin > 0 ? Math.round(o.plannedMin) : 0,
    due: isDayKey(o.due) ? o.due : null,
    closed: o.closed === true,
    note: typeof o.note === 'string' ? o.note : '',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
  }
}

export interface RestoreResult {
  tasks: Task[]
  /** 予定。古いファイルには入っていないので空になる */
  plans: Plan[]
  /** 案件。古いファイルには入っていないので空になる */
  jobs: Job[]
  settings: Partial<Settings> | null
  /** 形が合わずに取り込めなかった件数 */
  skipped: number
}

/** バックアップJSONを読む。読めない場合は例外を投げ、呼び出し側で文言にする。 */
export function readBackup(json: string): RestoreResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('ファイルをJSONとして読めませんでした。書き出したファイルをそのままお使いください。')
  }
  const arr =
    Array.isArray(data)
      ? data
      : typeof data === 'object' && data !== null && Array.isArray((data as BackupFile).tasks)
        ? (data as BackupFile).tasks
        : null
  if (!arr) throw new Error('タスクの配列が見つかりませんでした。Taskport から書き出したファイルか確認してください。')

  const tasks: Task[] = []
  let skipped = 0
  for (const raw of arr) {
    const t = toTask(raw)
    if (t) tasks.push(t)
    else skipped++
  }
  const plans: Plan[] = []
  if (typeof data === 'object' && data !== null && Array.isArray((data as BackupFile).plans)) {
    for (const item of (data as BackupFile).plans as unknown[]) {
      const p = toPlan(item)
      if (p) plans.push(p)
      else skipped++
    }
  }
  const jobs: Job[] = []
  if (typeof data === 'object' && data !== null && Array.isArray((data as BackupFile).jobs)) {
    for (const item of (data as BackupFile).jobs as unknown[]) {
      const j = toJob(item)
      if (j) jobs.push(j)
      else skipped++
    }
  }
  const raw =
    typeof data === 'object' && data !== null && typeof (data as BackupFile).settings === 'object'
      ? ((data as BackupFile).settings as Partial<Settings>)
      : null
  // 区分のマスタは形を確かめてから入れる（壊れていると区分が全部選べなくなる）
  const settings = raw
    ? { ...raw, categoryGroups: normalizeGroups(raw.categoryGroups) }
    : null
  return { tasks, plans, jobs, settings, skipped }
}
