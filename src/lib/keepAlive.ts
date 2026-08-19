/* =========================================================
 * バックグラウンド維持（NoteLoop 9.2 と同じ作り）
 *
 * スマホでは画面を消すとページが凍結され、録音も音声認識も止まる。
 * これを防ぐため、その間は「ほぼ無音」の音声をループ再生して
 * メディアセッションを「再生中」に保つ。ブラウザはメディアを再生している
 * タブを凍結しないため、画面を消しても処理が続く。
 * （Wake Lock は画面を点けたままにするだけで、電源ボタンで消すと解放される）
 * =======================================================*/

let silentAudio: HTMLAudioElement | null = null
let silentUrl: string | null = null
/** いま何のために無音再生を続けているか */
let mode: '' | 'recording' | 'processing' = ''
let onStopRequest: (() => void) | null = null

/**
 * ほぼ無音（-90dBFS 相当・実質的に聞こえない）の WAV を作る。
 * 完全な無音（全サンプル0）は一部ブラウザで「再生していない」と判定されるため、
 * 極小振幅の信号を入れて確実に再生中と認識させる。
 */
function makeSilentWavUrl(seconds = 2, sampleRate = 8000): string {
  const frames = seconds * sampleRate
  const dataSize = frames * 2 // 16bit mono
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE')
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true)
  view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, dataSize, true)
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

/** ロック画面などに状態と停止操作を出す */
function setupMediaSession(): void {
  if (!('mediaSession' in navigator)) return
  const proc = mode === 'processing'
  try {
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: proc ? 'タスクにしています — Taskport' : '● 録音中 — Taskport',
        artist: proc ? '画面を消しても処理は続きます' : '画面を消しても録音は続きます',
        album: 'Taskport',
      })
    }
    navigator.mediaSession.playbackState = 'playing'
    // 処理中は「止める操作」を持たせない（誤操作で結果が消えるのを防ぐ）
    const stop = () => onStopRequest?.()
    navigator.mediaSession.setActionHandler('stop', proc ? null : stop)
    navigator.mediaSession.setActionHandler('pause', proc ? null : stop)
    navigator.mediaSession.setActionHandler('play', () => resumeKeepAlive())
  } catch {
    /* 非対応でも処理は継続 */
  }
}

/**
 * 録音開始時・処理開始時に呼ぶ。
 * 自動再生を許可させるため、必ず利用者の操作直後に呼ぶこと。
 */
export function startKeepAlive(next: 'recording' | 'processing', stopRequest?: () => void): void {
  mode = next
  if (stopRequest) onStopRequest = stopRequest
  try {
    if (!silentAudio) {
      silentUrl = makeSilentWavUrl()
      silentAudio = new Audio(silentUrl)
      silentAudio.loop = true
      silentAudio.setAttribute('playsinline', '')
      // バックグラウンドで止められたら、まだ維持が必要ならすぐ再生し直す
      silentAudio.addEventListener('pause', () => {
        if (mode) resumeKeepAlive()
      })
    }
    void silentAudio.play().catch(() => {
      /* 自動再生を拒否されても録音自体は続く */
    })
  } catch {
    /* 無音再生ができなくても録音は続く */
  }
  setupMediaSession()
}

export function resumeKeepAlive(): void {
  if (!mode || !silentAudio) return
  try {
    if (silentAudio.paused) void silentAudio.play().catch(() => {})
  } catch {
    /* noop */
  }
}

export function stopKeepAlive(): void {
  mode = ''
  onStopRequest = null
  try {
    silentAudio?.pause()
  } catch {
    /* noop */
  }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none'
      navigator.mediaSession.setActionHandler('stop', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('play', null)
    } catch {
      /* noop */
    }
  }
}

export function releaseKeepAlive(): void {
  stopKeepAlive()
  if (silentUrl) {
    URL.revokeObjectURL(silentUrl)
    silentUrl = null
  }
  silentAudio = null
}

/* ---------------------------------------------------------
 * Wake Lock（画面を点けたままにする）
 * ------------------------------------------------------- */

let wakeLock: WakeLockSentinel | null = null

/**
 * いま画面を点けたままにしている理由の集まり。
 * 録音中とアプリを開いている間の2つが同時に要ることがあり、
 * 片方が終わったときにもう片方まで消さないよう、数えてから外す。
 */
const holders = new Set<string>()

export function wakeLockSupported(): boolean {
  return 'wakeLock' in navigator
}

/** @param reason 誰が要求しているか（'recording' / 'app'） */
export async function acquireWakeLock(reason = 'recording'): Promise<void> {
  holders.add(reason)
  if (wakeLock) return // 取り直すと前のロックを手放せなくなる
  if (!wakeLockSupported()) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => {
      wakeLock = null // 画面非表示などで自動解放される
    })
  } catch {
    wakeLock = null
  }
}

export async function releaseWakeLock(reason = 'recording'): Promise<void> {
  holders.delete(reason)
  if (holders.size > 0) return // まだ要る人がいる
  try {
    await wakeLock?.release()
  } catch {
    /* noop */
  }
  wakeLock = null
}

/**
 * 画面が戻ってきたときに取り直す。
 * 画面を消したりアプリを裏へ回したりすると、端末側でロックが外れる。
 * 要求している人が残っていれば、戻った時点で取り直す。
 */
export async function refreshWakeLock(): Promise<void> {
  if (holders.size === 0 || wakeLock) return
  if (!wakeLockSupported()) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => {
      wakeLock = null
    })
  } catch {
    wakeLock = null
  }
}
