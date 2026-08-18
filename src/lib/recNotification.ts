/* =========================================================
 * 録音中の常駐通知（NoteLoop 9.2 と同じ体裁）
 *
 * Service Worker の showNotification で常駐通知を出し、
 * 「左にゲージ・続けて録音時間・操作は一時停止と録音完了」の並びにそろえる。
 * 通知のアクションは sw-notify.js が postMessage でここへ返してくる。
 * 画面を消していても、通知から録音を止められる。
 * =======================================================*/

const TAG = 'taskport-recording'

export interface NotifState {
  /** "00:12" */
  elapsed: string
  paused: boolean
  /** 音声が取り込めていない（警告表示に切り替える） */
  stalled: boolean
  /** マイク入力の大きさ 0〜1。ゲージの高さに使う */
  level: number
}

export async function ensureNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

export function notifyBlocked(): boolean {
  return 'Notification' in window && Notification.permission === 'denied'
}

let phase = 0

/**
 * 通知の左に置くゲージ（バー5本）。
 * 声が大きいほど高く伸び、1本ずつばらばらに揺れる。
 */
function gauge(level: number, paused: boolean): string {
  const GLYPH = '▁▂▃▄▅▆▇█'
  if (paused) return '▁▁▁▁▁'
  phase += 0.6
  const amp = 0.3 + Math.max(0, Math.min(1, level)) * 0.7
  let out = ''
  for (let i = 0; i < 5; i++) {
    const wob = 0.5 + 0.5 * Math.sin(phase * 1.1 + i * 1.25)
    out += GLYPH[Math.floor(Math.min(0.999, 0.06 + amp * wob) * GLYPH.length)]
  }
  return out
}

/** 録音中の常駐通知を出す／更新する */
export async function showRecordingNotification(state: NotifState): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  if (!(await ensureNotifyPermission())) return
  const time = state.elapsed || '00:00'
  const base = import.meta.env.BASE_URL || '/'
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(state.stalled ? `⚠ 録音を再開中　${time}` : `${gauge(state.level, state.paused)}　${time}`, {
      body: state.stalled
        ? '音声が取り込めていません。画面を点けてアプリを前面に戻してください。'
        : state.paused
          ? 'Taskport — 一時停止中。再開すると続きから録音します。'
          : 'Taskport — 録音中。画面を消しても録音は続きます。',
      tag: TAG,
      renotify: false,
      silent: true,
      requireInteraction: true,
      icon: `${base}icons/icon-192.png`,
      badge: `${base}icons/favicon-48.png`,
      actions: state.paused
        ? [
            { action: 'resume', title: '▶ 再開' },
            { action: 'stop', title: '■ 録音完了' },
          ]
        : [
            { action: 'pause', title: '❚❚ 一時停止' },
            { action: 'stop', title: '■ 録音完了' },
          ],
      data: { type: 'recording', paused: state.paused },
    } as NotificationOptions)
  } catch {
    /* 通知が使えなくても録音は継続する */
  }
}

export async function clearRecordingNotification(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const ns = await reg.getNotifications({ tag: TAG })
    ns.forEach((n) => n.close())
  } catch {
    /* noop */
  }
}

export type NotifCommand = 'stop' | 'pause' | 'resume'

/** 通知のアクションから届く操作を受け取る。戻り値で購読を解除する。 */
export function onNotificationCommand(handler: (cmd: NotifCommand) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {}
  const listener = (e: MessageEvent) => {
    const t = (e.data as { type?: string } | null)?.type
    if (t === 'tp-stop-recording') handler('stop')
    else if (t === 'tp-pause-recording') handler('pause')
    else if (t === 'tp-resume-recording') handler('resume')
  }
  navigator.serviceWorker.addEventListener('message', listener)
  return () => navigator.serviceWorker.removeEventListener('message', listener)
}
