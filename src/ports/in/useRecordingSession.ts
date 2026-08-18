import { useCallback, useEffect, useRef, useState } from 'react'
import { startMicLevel, type MicLevel } from '../../lib/micLevel'
import { SegmentRecorder, shortfallWarning, type RecorderReport } from '../../lib/recorder'
import {
  acquireWakeLock,
  releaseWakeLock,
  startKeepAlive,
  stopKeepAlive,
} from '../../lib/keepAlive'
import {
  clearRecordingNotification,
  ensureNotifyPermission,
  notifyBlocked,
  onNotificationCommand,
  showRecordingNotification,
} from '../../lib/recNotification'
import { voiceSupported } from './useVoiceInput'

/* =========================================================
 * 録音セッション（NoteLoop 9.2 と同じ流れ）
 *
 *   音声の確保（MediaRecorder）→ 認識の開始（Web Speech API）
 *   → 常駐通知・無音再生・Wake Lock を立てる
 *   → 停止 → 音声を1本にまとめ、認識テキストを返す
 *
 * NoteLoop と違うのは出口だけ。ここが返すのは議事録ではなく
 * 「自然文テキスト＋音声」で、呼び出し側が parseToTasks へ渡す。
 *
 * 音声は端末内にしか置かない。外部へ送るのは認識後のテキストだけ。
 * =======================================================*/

// Web Speech API は TS の標準 lib に無いので、使うぶんだけ最小で型を書く。
interface SRAlt { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlt }
interface SREvent { results: ArrayLike<SRResult> }
interface SRErrorEvent { error: string }
interface SRLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
}
type SRCtor = new () => SRLike

function getSR(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** 同じ語の繰り返し（認識の暴走）を軽く畳む */
function collapseLoops(text: string): string {
  return text.replace(/(.{2,12}?)\1{2,}/g, '$1')
}

function compose(segments: string[], current: string, interim: string): string {
  const parts: string[] = []
  const push = (p: string) => {
    const c = collapseLoops(p.trim()).trim()
    if (c && c !== parts[parts.length - 1]) parts.push(c)
  }
  for (const s of segments) push(s)
  const tail = (current + interim).trim()
  if (tail) parts.push(tail) // 途中結果は整形せずそのまま出す
  return parts.join(' ')
}

export interface RecordingResult {
  transcript: string
  audio: Blob | null
  durationSec: number
  report: RecorderReport
  warning: string | null
}

export interface RecordingSession {
  supported: boolean
  recording: boolean
  paused: boolean
  /** 音声が取り込めていない（見張りが録り直している最中） */
  stalled: boolean
  transcript: string
  /** 発話の勢い 0〜1。波形と通知のゲージに使う */
  level: number
  seconds: number
  error: string | null
  /** 通知が拒否されている（録音中の表示が出せない） */
  notificationBlocked: boolean
  start(): Promise<boolean>
  stop(): Promise<RecordingResult>
  togglePause(): void
  reset(): void
}

export function useRecordingSession(options: { keepAudio: boolean; keepAwake: boolean }): RecordingSession {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [stalled, setStalled] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [level, setLevel] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notificationBlocked, setNotificationBlocked] = useState(false)

  const recorderRef = useRef<SegmentRecorder | null>(null)
  const srRef = useRef<SRLike | null>(null)
  const runningRef = useRef(false)
  const pausedRef = useRef(false)
  const segmentsRef = useRef<string[]>([])
  const currentRef = useRef('')
  const startedAtRef = useRef(0)
  const pausedMsRef = useRef(0)
  const pausedAtRef = useRef(0)
  const levelRef = useRef(0)
  /** マイクの音量計。使えない環境では null（認識の合図で動かす） */
  const meterRef = useRef<MicLevel | null>(null)
  /** 音量計を張っている流れ。見張りが取り直したら張り替える */
  const meterStreamRef = useRef<MediaStream | null>(null)
  /** 音量計だけのために取った流れ（録音を残さない設定のとき） */
  const meterOnlyStreamRef = useRef<MediaStream | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const supported = voiceSupported()

  const commitSegment = useCallback(() => {
    const seg = collapseLoops(currentRef.current.trim()).trim()
    currentRef.current = ''
    const segs = segmentsRef.current
    if (seg && seg !== segs[segs.length - 1]) segs.push(seg)
  }, [])

  /** 認識を張る。勝手に切れたら確定分をコミットして張り直す。 */
  const beginRecognition = useCallback(() => {
    const SR = getSR()
    if (!SR) return false
    try {
      const sr = new SR()
      sr.lang = 'ja-JP'
      sr.continuous = true
      sr.interimResults = true
      sr.onresult = (e) => {
        if (pausedRef.current) return
        let finalText = ''
        let interim = ''
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        currentRef.current = finalText
        setTranscript(compose(segmentsRef.current, finalText, interim))
        // 音量計が使えないときの受け皿。使えるときは実測を優先する。
        if (!meterRef.current) {
          levelRef.current = 0.85
          setLevel(0.85)
        }
      }
      sr.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setError('マイクが使えませんでした。ブラウザのマイク許可を確認するか、キーボード入力をお使いください。')
        } else if (e.error === 'network') {
          setError('音声認識にインターネット接続が必要です。録音は続いています。')
        }
        // no-speech / aborted は onend で張り直すので黙って流す
      }
      sr.onend = () => {
        if (runningRef.current) {
          commitSegment()
          window.setTimeout(() => {
            if (runningRef.current) beginRecognition()
          }, 200)
        }
      }
      sr.start()
      srRef.current = sr
      return true
    } catch {
      return false
    }
  }, [commitSegment])

  const stopRecognition = useCallback(() => {
    const sr = srRef.current
    if (sr) {
      sr.onend = null
      sr.onresult = null
      try {
        sr.stop()
      } catch {
        /* 既に止まっている */
      }
      try {
        sr.abort()
      } catch {
        /* 既に止まっている */
      }
      srRef.current = null
    }
    commitSegment()
  }, [commitSegment])

  const elapsedSec = useCallback(() => {
    if (!startedAtRef.current) return 0
    const extra = pausedAtRef.current ? Date.now() - pausedAtRef.current : 0
    return Math.floor((Date.now() - startedAtRef.current - pausedMsRef.current - extra) / 1000)
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    if (runningRef.current) return true
    setError(null)
    segmentsRef.current = []
    currentRef.current = ''
    setTranscript('')
    pausedMsRef.current = 0
    pausedAtRef.current = 0
    setPaused(false)
    pausedRef.current = false
    setStalled(false)

    // 通知の許可は操作直後に聞く（後から聞くと拒否されやすい）
    await ensureNotifyPermission()
    setNotificationBlocked(notifyBlocked())

    // 先に録音用マイクを確保してから認識を始める（NoteLoop と同じ順）
    if (optionsRef.current.keepAudio) {
      const rec = new SegmentRecorder()
      rec.onStateChange = () => setStalled(rec.stalled)
      const ok = await rec.start()
      if (ok) recorderRef.current = rec
      else recorderRef.current = null
    }

    // ゲージ用にマイクの音量を測る。録音を残さない設定でも動かしたいので、
    // 録音用の流れが無いときはここだけのために取る（音は残さない）。
    try {
      let stream = recorderRef.current?.getStream() ?? null
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        meterOnlyStreamRef.current = stream
      }
      meterRef.current = startMicLevel(stream)
      meterStreamRef.current = stream
    } catch {
      // マイクが取れなくても録音と認識は続ける（ゲージだけが動かない）
      meterRef.current = null
    }

    runningRef.current = true
    startedAtRef.current = Date.now()
    setSeconds(0)
    setRecording(true)

    // 画面を消しても止まらないようにする（利用者の操作直後に呼ぶ必要がある）
    startKeepAlive('recording', () => {
      void stopRef.current?.()
    })
    if (optionsRef.current.keepAwake) void acquireWakeLock()

    if (!beginRecognition() && !recorderRef.current) {
      runningRef.current = false
      setRecording(false)
      stopKeepAlive()
      void releaseWakeLock()
      setError('録音を開始できませんでした。マイクの許可を確認するか、キーボード入力をお使いください。')
      return false
    }
    return true
  }, [beginRecognition])

  const stop = useCallback(async (): Promise<RecordingResult> => {
    runningRef.current = false
    setRecording(false)
    setPaused(false)
    pausedRef.current = false
    const durationSec = elapsedSec()

    stopRecognition()

    // 音量計とその流れを片づける（マイクの表示を消すため、必ず止める）
    meterRef.current?.stop()
    meterRef.current = null
    meterStreamRef.current = null
    meterOnlyStreamRef.current?.getTracks().forEach((t) => t.stop())
    meterOnlyStreamRef.current = null

    const text = compose(segmentsRef.current, '', '')
    setTranscript(text)
    levelRef.current = 0
    setLevel(0)

    let audio: Blob | null = null
    let report: RecorderReport = { elapsedMs: durationSec * 1000, capturedMs: durationSec * 1000, recovered: 0, droppedSegments: 0 }
    const rec = recorderRef.current
    recorderRef.current = null
    if (rec) {
      const result = await rec.stop()
      audio = result.blob
      report = result.report
    }

    void clearRecordingNotification()
    stopKeepAlive()
    void releaseWakeLock()

    return { transcript: text, audio, durationSec, report, warning: shortfallWarning(report) }
  }, [elapsedSec, stopRecognition])

  // 通知やロック画面からの停止で使うため、最新の stop を ref に持つ
  const stopRef = useRef<(() => Promise<RecordingResult>) | null>(null)
  stopRef.current = stop

  const togglePause = useCallback(() => {
    if (!runningRef.current) return
    const next = !pausedRef.current
    pausedRef.current = next
    setPaused(next)
    if (next) {
      pausedAtRef.current = Date.now()
      stopRecognition()
    } else {
      pausedMsRef.current += Date.now() - pausedAtRef.current
      pausedAtRef.current = 0
      beginRecognition()
    }
    recorderRef.current?.setPaused(next)
  }, [beginRecognition, stopRecognition])

  const reset = useCallback(() => {
    segmentsRef.current = []
    currentRef.current = ''
    setTranscript('')
    setError(null)
    setSeconds(0)
  }, [])

  // 経過秒
  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => setSeconds(elapsedSec()), 500)
    return () => window.clearInterval(id)
  }, [recording, elapsedSec])

  /**
   * ゲージに出す音量。
   *   音量計があるとき … マイクの実際の大きさをそのまま出す
   *   無いとき         … 認識が返ってきた合図で跳ねさせ、あとは減衰させる
   * 一時停止中は 0（ゲージは点に戻る）。
   */
  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => {
      if (pausedRef.current) {
        levelRef.current = 0
        setLevel(0)
        return
      }
      const meter = meterRef.current
      if (meter) {
        // 見張りがマイクを取り直したら、音量計も張り替える
        const now = recorderRef.current?.getStream() ?? meterOnlyStreamRef.current
        if (now && now !== meterStreamRef.current) {
          meter.stop()
          meterRef.current = startMicLevel(now)
          meterStreamRef.current = now
        }
        levelRef.current = meterRef.current?.value() ?? 0
      } else {
        levelRef.current = levelRef.current > 0.02 ? levelRef.current * 0.86 : 0
      }
      setLevel(levelRef.current)
    }, 60)
    return () => window.clearInterval(id)
  }, [recording])

  // 常駐通知を1秒ごとに更新する
  useEffect(() => {
    if (!recording) return
    const tick = () => {
      const s = elapsedSec()
      const mm = String(Math.floor(s / 60)).padStart(2, '0')
      const ss = String(s % 60).padStart(2, '0')
      void showRecordingNotification({
        elapsed: `${mm}:${ss}`,
        paused: pausedRef.current,
        stalled,
        level: levelRef.current,
      })
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [recording, stalled, elapsedSec])

  // 通知のボタンからの操作
  useEffect(() => {
    return onNotificationCommand((cmd) => {
      if (!runningRef.current) return
      if (cmd === 'stop') void stopRef.current?.()
      else if (cmd === 'pause' && !pausedRef.current) togglePause()
      else if (cmd === 'resume' && pausedRef.current) togglePause()
    })
  }, [togglePause])

  // 画面から復帰したら、止められているものを起こし直す
  useEffect(() => {
    if (!recording) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (optionsRef.current.keepAwake) void acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [recording])

  // 後片付け
  useEffect(
    () => () => {
      runningRef.current = false
      const sr = srRef.current
      if (sr) {
        sr.onend = null
        try {
          sr.abort()
        } catch {
          /* noop */
        }
      }
      void clearRecordingNotification()
      stopKeepAlive()
      void releaseWakeLock()
    },
    [],
  )

  return {
    supported,
    recording,
    paused,
    stalled,
    transcript,
    level,
    seconds,
    error,
    notificationBlocked,
    start,
    stop,
    togglePause,
    reset,
  }
}
