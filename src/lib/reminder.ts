import { addDaysKey, dayKey, diffDays, toMinutes } from './date'
import type { Settings, Task } from '../types'

/* =========================================================
 * 期限のリマインド
 *
 * 時刻を入れたタスクの N 分前に通知を出す。
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

/** 何日先まで予約しておくか。先まで積むと予約が溜まりすぎる。 */
const HORIZON_DAYS = 7

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

/** これから通知すべきタスク（近い順）。今日から HORIZON_DAYS 日先まで。 */
export function upcoming(tasks: Task[], leadMin: number, now = Date.now()): { task: Task; at: number }[] {
  const today = dayKey(now)
  const limit = addDaysKey(today, HORIZON_DAYS)
  const out: { task: Task; at: number }[] = []
  for (const task of tasks) {
    if (!task.due || diffDays(task.due, limit) > 0) continue
    const at = remindAt(task, leadMin)
    if (at === null || at <= now) continue
    out.push({ task, at })
  }
  return out.sort((a, b) => a.at - b.at)
}

function body(task: Task, leadMin: number): string {
  const when = task.dueTime ? `${task.dueTime} 締め` : '本日締め'
  const lead = leadMin > 0 ? `あと${leadMin}分。` : ''
  return `${lead}${when}${task.category ? ` ／ ${task.category}` : ''}`
}

/**
 * 予約をすべて張り直す。タスクや設定が変わるたびに呼ぶ。
 * 予約つき通知が使えない環境では何もしない（タイマー側が受け持つ）。
 */
export async function rescheduleReminders(tasks: Task[], settings: Settings): Promise<void> {
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
    existing.filter((n) => n.tag.startsWith(TAG_PREFIX)).forEach((n) => n.close())
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
}

/** すべての予約を消す（設定で切ったとき） */
export async function clearReminders(): Promise<void> {
  if (!notificationsUsable()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const ns = await reg.getNotifications({ includeTriggered: true } as GetNotificationOptions)
    ns.filter((n) => n.tag.startsWith(TAG_PREFIX)).forEach((n) => n.close())
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
export function startForegroundReminders(
  getTasks: () => Task[],
  getSettings: () => Settings,
  onFire: (task: Task) => void,
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
    const next = upcoming(getTasks(), settings.reminderLeadMin).find((u) => !fired.has(u.task.id))
    if (!next) return
    // setTimeout は 24.8 日を超えると即発火するので、長いときは刻んで待つ
    const wait = Math.min(next.at - Date.now(), 10 * 60_000)
    timer = setTimeout(() => {
      if (Date.now() >= next.at - 1000) {
        fired.add(next.task.id)
        onFire(next.task)
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

/** 受け皿から実際に通知を出す */
export async function showDueNotification(task: Task, leadMin: number): Promise<void> {
  if (!notificationsUsable() || Notification.permission !== 'granted') return
  const base = import.meta.env.BASE_URL || '/'
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(task.title, {
      body: body(task, leadMin),
      tag: `${TAG_PREFIX}${task.id}`,
      icon: `${base}icons/icon-192.png`,
      badge: `${base}icons/favicon-48.png`,
      data: { type: 'due', taskId: task.id },
    })
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
