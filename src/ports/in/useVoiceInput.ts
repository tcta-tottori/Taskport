import { useCallback, useEffect, useRef, useState } from 'react'

/* =========================================================
 * 音声入力（Web Speech API）
 *
 * 認識はブラウザ側で行い、外に出るのは認識後のテキストだけ。
 * 音声データそのものを送信する実装をここに足さないこと。
 *
 * NoteLoop と同じ作りにしてある：
 *   - continuous / interimResults / ja-JP
 *   - 認識が勝手に切れたら確定分をコミットして自動で張り直す
 *   - 確定分は配列に積み、途中結果は末尾に薄く足して表示する
 * =======================================================*/

// Web Speech API は TS の標準 lib に無いので、使うぶんだけ最小で型を書く。
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionErrorEventLike {
  error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSR(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const voiceSupported = (): boolean => getSR() !== null

export interface VoiceInput {
  supported: boolean
  recording: boolean
  /** 確定分＋途中結果を結合した表示用テキスト */
  transcript: string
  /** 発話の勢い 0〜1。波形の振れ幅に使う */
  level: number
  error: string | null
  /** 録音時間（秒） */
  seconds: number
  start(): Promise<void>
  /** 停止して、確定したテキストを返す */
  stop(): string
  reset(): void
}

/** 同じ語の繰り返し（認識の暴走）を軽く畳む */
function collapseLoops(text: string): string {
  return text.replace(/(.{2,12}?)\1{2,}/g, '$1')
}

function compose(base: string, segments: string[], current: string, interim: string): string {
  const parts: string[] = []
  const push = (p: string) => {
    const c = collapseLoops(p.trim()).trim()
    if (c && c !== parts[parts.length - 1]) parts.push(c)
  }
  if (base) push(base)
  for (const s of segments) push(s)
  // 途中結果は整形せずそのまま出す（取りこぼしと遅延を防ぐ）
  const tail = (current + interim).trim()
  if (tail) parts.push(tail)
  return parts.join(' ')
}

export function useVoiceInput(initialText = ''): VoiceInput {
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState(initialText)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recordingRef = useRef(false)
  const baseRef = useRef('')
  const segmentsRef = useRef<string[]>([])
  const currentRef = useRef('')
  const startedAtRef = useRef(0)
  const tickRef = useRef<number | null>(null)
  const decayRef = useRef<number | null>(null)

  const supported = voiceSupported()

  const commitSegment = useCallback(() => {
    const seg = collapseLoops(currentRef.current.trim()).trim()
    currentRef.current = ''
    const segs = segmentsRef.current
    if (seg && seg !== segs[segs.length - 1]) segs.push(seg)
  }, [])

  const begin = useCallback(() => {
    const SR = getSR()
    if (!SR) return false
    try {
      const rec = new SR()
      rec.lang = 'ja-JP'
      rec.continuous = true
      rec.interimResults = true
      rec.onresult = (e) => {
        // 差分を足さず、現インスタンスの結果全体から毎回組み立て直す（重複防止）
        let finalText = ''
        let interim = ''
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        currentRef.current = finalText
        setTranscript(compose(baseRef.current, segmentsRef.current, finalText, interim))
        setLevel(0.85) // 発話に反応して波を動かす
      }
      rec.onerror = (e) => {
        // no-speech / aborted は onend で張り直すので黙って流す
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setError(
            'マイクが使えませんでした。ブラウザのマイク許可を確認するか、キーボード入力をお使いください。',
          )
          recordingRef.current = false
          setRecording(false)
        } else if (e.error === 'network') {
          setError('音声認識にインターネット接続が必要です。接続を確認するか、キーボード入力をお使いください。')
        } else if (e.error === 'no-speech') {
          setError('音声を検出できませんでした。もう一度話すか、キーボード入力をお使いください。')
        }
      }
      rec.onend = () => {
        // 録音継続中に認識が切れたら、確定分をコミットして新インスタンスで再開
        if (recordingRef.current) {
          commitSegment()
          window.setTimeout(() => {
            if (recordingRef.current) begin()
          }, 200)
        }
      }
      rec.start()
      recognitionRef.current = rec
      return true
    } catch {
      return false
    }
  }, [commitSegment])

  const start = useCallback(async () => {
    if (recordingRef.current) return
    if (!getSR()) {
      setError('このブラウザは音声入力に対応していません。キーボード入力をお使いください。')
      return
    }
    setError(null)
    baseRef.current = transcript.trim()
    segmentsRef.current = []
    currentRef.current = ''
    recordingRef.current = true
    setRecording(true)
    startedAtRef.current = Date.now()
    setSeconds(0)
    if (!begin()) {
      recordingRef.current = false
      setRecording(false)
      setError('音声入力を開始できませんでした。キーボード入力をお使いください。')
    }
  }, [begin, transcript])

  const stop = useCallback((): string => {
    recordingRef.current = false
    setRecording(false)
    const rec = recognitionRef.current
    if (rec) {
      rec.onend = null
      rec.onresult = null
      try {
        rec.stop()
      } catch {
        /* 既に止まっている */
      }
      try {
        rec.abort()
      } catch {
        /* 既に止まっている */
      }
      recognitionRef.current = null
    }
    commitSegment()
    const final = compose(baseRef.current, segmentsRef.current, '', '')
    setTranscript(final)
    setLevel(0)
    return final
  }, [commitSegment])

  const reset = useCallback(() => {
    baseRef.current = ''
    segmentsRef.current = []
    currentRef.current = ''
    setTranscript('')
    setError(null)
    setSeconds(0)
  }, [])

  // 経過秒。録音中だけ動かす。
  useEffect(() => {
    if (!recording) {
      if (tickRef.current !== null) window.clearInterval(tickRef.current)
      tickRef.current = null
      return
    }
    tickRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 500)
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [recording])

  // 発話イベントで跳ねた level を、話が止まったらゆっくり戻す
  useEffect(() => {
    if (!recording) return
    decayRef.current = window.setInterval(() => {
      setLevel((v) => (v > 0.02 ? v * 0.86 : 0))
    }, 90)
    return () => {
      if (decayRef.current !== null) window.clearInterval(decayRef.current)
      decayRef.current = null
    }
  }, [recording])

  useEffect(
    () => () => {
      recordingRef.current = false
      const rec = recognitionRef.current
      if (rec) {
        rec.onend = null
        try {
          rec.abort()
        } catch {
          /* noop */
        }
      }
    },
    [],
  )

  return { supported, recording, transcript, level, error, seconds, start, stop, reset }
}
