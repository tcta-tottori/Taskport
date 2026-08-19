import { addDaysKey, dayKey, diffDays, toMinutes } from './date'
import { planSpan } from './plans'
import type { PlanOccurrence, Settings, Task } from '../types'

/* =========================================================
 * 期限と予定のリマインド
 *
 * 時刻を入れたタスクの期限と、予定（打合せ・固定の業務）の開始の
 * N 分前に通知を出す。
 *
 * 【できることの限界を先に書く】
 * これは端末内で完結する PWA なので、通知を配るサーバ（プッシュ）を持たない。
 * 使える道は2つで、どちらも取りこぼしがある。
 *
 *  1. 予約つき通知（Notification Triggers）
 *     Service Worker に「この時刻に出して」と先に預ける。アプリを閉じていても
 *     出る。Chrome 系でのみ使える。使えるかは実行時に見て決める。
 *
 *  2. アプリを開いている間のタイマー
 *     1 が無い環境の受け皿。画面を閉じている間は動かない。
 *
 * どちらの場合も「アプリを一度も開かない日は通知が出ないことがある」ため、
 * 設定画面にそのまま書く。黙って落とすより、出ない条件を先に伝えるほうがよい。
 * =======================================================*/

const TAG_PREFIX = 'taskport-due-'
/** 予定ぶんの札。タスクと分けておくと、片方だけ張り直せる */
const PLAN_TAG_PREFIX = 'taskport-plan-'

/** 自分が張ったリマインドか（録音の常駐通知を巻き込まないための判定） */
function isReminderTag(tag: string): boolean {
  return tag.startsWith(TAG_PREFIX) || tag.startsWith(PLAN_TAG_PREFIX)
}

/** 何日先まで予約しておくか。先まで積むと予約が溜まりすぎる。 */
const HORIZON_DAYS = 7

/**
 * 少しだけ過ぎたものも出す猶予。
 * 同じ分に2件重なったときや、通知を出した直後の張り直しで、
 * 「もう過ぎた」として黙って落ちるのを防ぐ。長く取ると、
 * 昼に開いたときに朝のぶんがまとめて出るので短くする。
 */
const GRACE_MS = 2 * 60_000

/** 予約つき通知が使えるか（Chrome 系のみ） */
export function triggersSupported(): boolean {
  return typeof Notification !== 'undefined' && 'showTrigger' in Notification.prototype
}

export function notificationsUsable(): boolean {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator
}

export async function askPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

/** 通知を出す時刻（ミリ秒）。時刻の無いタスクは対象外なので null。 */
export function remindAt(task: Task, leadMin: number): number | null {
  if (task.status !== 'open' || !task.due || !task.dueTime) return null
  const min = toMinutes(task.dueTime)
  if (min === null) return null
  const [y, m, d] = task.due.split('-').map(Number)
  const at = new Date(y, m - 1, d, 0, min - Math.max(0, leadMin), 0, 0)
  return at.getTime()
}

/**
 * これから通知すべきタスク（近い順）。今日から HORIZON_DAYS 日先まで。
 * @param graceMs 少しだけ過ぎたものも含める幅（0 なら未来のぶんだけ）
 */
export function upcoming(
  tasks: Task[],
  leadMin: number,
  now = Date.now(),
  graceMs = 0,
): { task: Task; at: number }[] {
  const today = dayKey(now)
  const limit = addDaysKey(today, HORIZON_DAYS)
  const floor = now - graceMs
  const out: { task: Task; at: number }[] = []
  for (const task of tasks) {
    if (!task.due || diffDays(task.due, limit) > 0) continue
    const at = remindAt(task, leadMin)
    if (at === null || at <= floor) continue
    out.push({ task, at })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** 予定の通知を出す時刻（ミリ秒）。終日と時刻なしは対象外。 */
export function remindAtPlan(occ: PlanOccurrence, leadMin: number): number | null {
  if (occ.plan.allDay || !occ.plan.startTime) return null
  const min = toMinutes(occ.plan.startTime)
  if (min === null) return null
  const [y, m, d] = occ.day.split('-').map(Number)
  return new Date(y, m - 1, d, 0, min - Math.max(0, leadMin), 0, 0).getTime()
}

/** これから通知すべき予定（近い順） */
export function upcomingPlans(
  occurrences: PlanOccurrence[],
  leadMin: number,
  now = Date.now(),
  graceMs = 0,
): { occ: PlanOccurrence; at: number }[] {
  const limit = addDaysKey(dayKey(now), HORIZON_DAYS)
  const floor = now - graceMs
  const out: { occ: PlanOccurrence; at: number }[] = []
  for (const occ of occurrences) {
    if (diffDays(occ.day, limit) > 0) continue
    const at = remindAtPlan(occ, leadMin)
    if (at === null || at <= floor) continue
    out.push({ occ, at })
  }
  return out.sort((a, b) => a.at - b.at)
}

function planBody(occ: PlanOccurrence, leadMin: number): string {
  const lead = leadMin > 0 ? `あと${leadMin}分。` : ''
  const where = occ.plan.place ? ` ／ ${occ.plan.place}` : ''
  return `${lead}${planSpan(occ.plan)}${where}`
}

function body(task: Task, leadMin: number): string {
  const when = task.dueTime ? `${task.dueTime} 締め` : '本日締め'
  const lead = leadMin > 0 ? `あと${leadMin}分。` : ''
  const cat = task.categories.join(' / ')
  return `${lead}${when}${cat ? ` ／ ${cat}` : ''}`
}

/**
 * 予約をすべて張り直す。タスクや設定が変わるたびに呼ぶ。
 * 予約つき通知が使えない環境では何もしない（タイマー側が受け持つ）。
 */
export async function rescheduleReminders(
  tasks: Task[],
  plans: PlanOccurrence[],
  settings: Settings,
): Promise<void> {
  if (!notificationsUsable() || !triggersSupported()) return
  if (Notification.permission !== 'granted') return

  let reg: ServiceWorkerRegistration
  try {
    reg = await navigator.serviceWorker.ready
  } catch {
    return
  }

  // 予約済みのぶんを一度すべて畳む（tag で自分のものだけを拾う）
  try {
    const existing = await reg.getNotifications({ includeTriggered: true } as GetNotificationOptions)
    existing.filter((n) => isReminderTag(n.tag)).forEach((n) => n.close())
  } catch {
    /* 取れない環境では張り直しだけ行う */
  }

  if (!settings.reminderEnabled) return

  const base = import.meta.env.BASE_URL || '/'
  for (const { task, at } of upcoming(tasks, settings.reminderLeadMin)) {
    try {
      await reg.showNotification(task.title, {
        body: body(task, settings.reminderLeadMin),
        tag: `${TAG_PREFIX}${task.id}`,
        icon: `${base}icons/icon-192.png`,
        badge: `${base}icons/favicon-48.png`,
        data: { type: 'due', taskId: task.id },
        showTrigger: new (window as unknown as { TimestampTrigger: new (t: number) => unknown })
          .TimestampTrigger(at),
      } as NotificationOptions)
    } catch {
      /* 1件失敗しても残りは張る */
    }
  }

  // 予定ぶん。台帳とは別に持っているので、鍵（予定ID:日付）で札を作る
  for (const { occ, at } of upcomingPlans(plans, settings.reminderLeadMin)) {
    try {
      await reg.showNotification(occ.plan.title, {
        body: planBody(occ, settings.reminderLeadMin),
        tag: `${PLAN_TAG_PREFIX}${occ.key}`,
        icon: `${base}icons/icon-192.png`,
        badge: `${base}icons/favicon-48.png`,
        data: { type: 'plan', planKey: occ.key },
        showTrigger: new (window as unknown as { TimestampTrigger: new (t: number) => unknown })
          .TimestampTrigger(at),
      } as NotificationOptions)
    } catch {
      /* 1件失敗しても残りは張る */
    }
  }
}

/** すべての予約を消す（設定で切ったとき） */
export async function clearReminders(): Promise<void> {
  if (!notificationsUsable()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const ns = await reg.getNotifications({ includeTriggered: true } as GetNotificationOptions)
    ns.filter((n) => isReminderTag(n.tag)).forEach((n) => n.close())
  } catch {
    /* noop */
  }
}

export interface ForegroundReminders {
  /** タスクや設定が変わったら呼ぶ。張り直す。 */
  refresh(): void
  stop(): void
}

/**
 * 予約つき通知が無い環境の受け皿。
 * アプリを開いている間だけ、次の1件にタイマーを張る。
 *
 * 一度出したタスクは覚えておき、張り直しても二度は出さない。
 */
/** 通知を出す1件。タスクか、予定の1回ぶんか */
export type DueHit =
  | { kind: 'task'; task: Task; at: number }
  | { kind: 'plan'; occ: PlanOccurrence; at: number }

/**
 * 次に出すべき1件（タスクと予定を混ぜて、近い順）。
 * 少しだけ過ぎたぶん（GRACE_MS）も拾う。同じ分に2件あるときに、
 * 先の1件を出した拍子にもう1件が落ちるのを防ぐ。
 */
export function nextDueHit(
  tasks: Task[],
  plans: PlanOccurrence[],
  leadMin: number,
  skip: (key: string) => boolean,
  now = Date.now(),
): DueHit | null {
  const hits: DueHit[] = [
    ...upcoming(tasks, leadMin, now, GRACE_MS).map((u) => ({
      kind: 'task' as const,
      task: u.task,
      at: u.at,
    })),
    ...upcomingPlans(plans, leadMin, now, GRACE_MS).map((u) => ({
      kind: 'plan' as const,
      occ: u.occ,
      at: u.at,
    })),
  ]
  return hits.sort((a, b) => a.at - b.at).find((h) => !skip(hitKey(h))) ?? null
}

/** 出したかどうかを覚えておくための鍵 */
export function hitKey(hit: DueHit): string {
  return hit.kind === 'task' ? `t:${hit.task.id}` : `p:${hit.occ.key}`
}

export function startForegroundReminders(
  getTasks: () => Task[],
  getPlans: () => PlanOccurrence[],
  getSettings: () => Settings,
  onFire: (hit: DueHit) => void,
): ForegroundReminders {
  if (triggersSupported()) return { refresh() {}, stop() {} }
  let timer: ReturnType<typeof setTimeout> | null = null
  const fired = new Set<string>()
  let stopped = false

  const arm = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (stopped) return
    const settings = getSettings()
    if (!settings.reminderEnabled) return
    const next = nextDueHit(getTasks(), getPlans(), settings.reminderLeadMin, (k) => fired.has(k))
    if (!next) return
    // setTimeout は 24.8 日を超えると即発火するので、長いときは刻んで待つ
    const wait = Math.min(next.at - Date.now(), 10 * 60_000)
    timer = setTimeout(() => {
      if (Date.now() >= next.at - 1000) {
        fired.add(hitKey(next))
        onFire(next)
      }
      arm()
    }, Math.max(250, wait))
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') arm()
  }
  document.addEventListener('visibilitychange', onVisible)
  arm()

  return {
    refresh: arm,
    stop() {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    },
  }
}

/** 受け皿から実際に通知を出す（タスクの期限／予定の開始の両方） */
export async function showDueNotification(hit: DueHit, leadMin: number): Promise<void> {
  if (!notificationsUsable() || Notification.permission !== 'granted') return
  const base = import.meta.env.BASE_URL || '/'
  const common = {
    icon: `${base}icons/icon-192.png`,
    badge: `${base}icons/favicon-48.png`,
  }
  try {
    const reg = await navigator.serviceWorker.ready
    if (hit.kind === 'task') {
      await reg.showNotification(hit.task.title, {
        ...common,
        body: body(hit.task, leadMin),
        tag: `${TAG_PREFIX}${hit.task.id}`,
        data: { type: 'due', taskId: hit.task.id },
      })
    } else {
      await reg.showNotification(hit.occ.plan.title, {
        ...common,
        body: planBody(hit.occ, leadMin),
        tag: `${PLAN_TAG_PREFIX}${hit.occ.key}`,
        data: { type: 'plan', planKey: hit.occ.key },
      })
    }
  } catch {
    /* noop */
  }
}

/** 「10分前」「なし」 */
export function leadLabel(min: number): string {
  if (min <= 0) return '時刻ちょうど'
  if (min >= 60) return `${Math.round(min / 60)}時間前`
  return `${min}分前`
}
