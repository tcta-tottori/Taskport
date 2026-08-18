/* =========================================================
 * 録音の実体（MediaRecorder）— NoteLoop 9.2 と同じ作り
 *
 * 画面を消すとブラウザがタブを絞り、「タイマーは進んでいるのに
 * 音声が数分しか残っていない」事故が起きる。対策として
 *   ・一定間隔でデータを取り出し、常に手元に確定させる
 *   ・録音が止まっていないか見張り、止まったら録り直して継ぎ足す
 *   ・停止時に「経過時間」と「音声の実長」を比べ、足りなければ知らせる
 * の3段構えにしている。
 *
 * ここで録った音声は端末内にだけ置く。外部へ送信しない。
 * =======================================================*/

const TIMESLICE_MS = 3000 // この間隔でエンコード済みデータを取り出す
const WATCH_MS = 4000 // 録音が生きているかを確認する間隔
const STALL_MS = 12000 // この時間データが来なければ「止まった」と判断する

/** MediaRecorder が扱える形式を、扱いやすい順に選ぶ */
export function pickAudioMime(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  const prefs = [
    'audio/mp4;codecs=mp4a.40.2', // m4a。他のアプリやAIに渡しやすい
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
  ]
  for (const t of prefs) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t
    } catch {
      /* 次を試す */
    }
  }
  return ''
}

export interface RecorderReport {
  /** 経過時間（ミリ秒） */
  elapsedMs: number
  /** 実際に音声が取り込めていた時間（ミリ秒） */
  capturedMs: number
  /** 録り直した回数 */
  recovered: number
  /** 結合できずに捨てたセグメント数 */
  droppedSegments: number
}

export interface RecorderResult {
  blob: Blob | null
  report: RecorderReport
}

export class SegmentRecorder {
  private stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private segments: Blob[] = []
  private watchTimer: number | null = null
  private lastChunkAt = 0
  private capturedMs = 0
  private startedAt = 0
  private recovered = 0
  private dropped = 0
  private restarting = false
  private running = false
  private paused = false
  /** 音声が取り込めていない状態か（通知に警告を出すために見る） */
  stalled = false

  /** 見張りが状態を変えたときに呼ばれる（画面の表示更新用） */
  onStateChange: (() => void) | null = null

  isRunning(): boolean {
    return this.running
  }

  getStream(): MediaStream | null {
    return this.stream
  }

  private async getMic(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  }

  /**
   * 1セグメント分の録音を始める。
   * timeslice 付きで start するため ondataavailable が定期的に呼ばれ、
   * 途中でタブが落ちても直前までの音声が手元に残る。
   */
  private startSegment(stream: MediaStream): MediaRecorder | null {
    const mime = pickAudioMime()
    let rec: MediaRecorder
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch {
      try {
        rec = new MediaRecorder(stream)
      } catch {
        return null
      }
    }
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return
      const now = Date.now()
      // 実際に録れている時間を積む。チャンクが届いた区間だけを数えるので、
      // 端末に録音を止められていた時間は加算されない（＝経過時間との差が欠落）。
      if (this.lastChunkAt) this.capturedMs += Math.min(now - this.lastChunkAt, TIMESLICE_MS * 2)
      chunks.push(e.data)
      this.lastChunkAt = now
    }
    rec.onerror = () => {
      this.lastChunkAt = 0 // 見張り側で録り直す
    }
    try {
      rec.start(TIMESLICE_MS)
    } catch {
      try {
        rec.start()
      } catch {
        return null
      }
    }
    this.chunks = chunks
    this.lastChunkAt = Date.now()
    return rec
  }

  /** 現在のセグメントを閉じて積む（データは失わない） */
  private async sealSegment(): Promise<void> {
    const rec = this.rec
    this.rec = null
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        let done = false
        const fin = () => {
          if (!done) {
            done = true
            resolve()
          }
        }
        rec.onstop = fin
        setTimeout(fin, 2500) // 応答が無くても先に進む（停止処理を止めない）
        try {
          rec.stop()
        } catch {
          fin()
        }
      })
    }
    if (this.chunks.length) {
      this.segments.push(new Blob(this.chunks, { type: this.chunks[0].type || 'audio/webm' }))
    }
    this.chunks = []
  }

  async start(): Promise<boolean> {
    if (this.running) return true
    try {
      this.stream = await this.getMic()
    } catch {
      return false
    }
    this.rec = this.startSegment(this.stream)
    if (!this.rec) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
      return false
    }
    this.segments = []
    this.capturedMs = 0
    this.recovered = 0
    this.dropped = 0
    this.stalled = false
    this.paused = false
    this.running = true
    this.startedAt = Date.now()
    this.watchTimer = window.setInterval(() => void this.watchdog(), WATCH_MS)
    return true
  }

  setPaused(next: boolean): void {
    if (!this.running) return
    this.paused = next
    try {
      if (next && this.rec?.state === 'recording') this.rec.pause()
      else if (!next && this.rec?.state === 'paused') this.rec.resume()
    } catch {
      /* 非対応なら見張りが録り直す */
    }
    if (!next) this.lastChunkAt = Date.now()
  }

  isPaused(): boolean {
    return this.paused
  }

  /**
   * 録音が止まっていないか見張る。
   * データが来ない／マイクが切れた／MediaRecorder が死んだ場合は、
   * マイクを取り直して録音を再開し、音声を継ぎ足す。
   */
  private async watchdog(): Promise<void> {
    if (!this.running || this.paused || this.restarting) return
    const track = this.stream?.getAudioTracks()[0] ?? null
    const micDead = !track || track.readyState === 'ended'
    const recDead = !this.rec || this.rec.state === 'inactive'
    const stalled = !this.lastChunkAt || Date.now() - this.lastChunkAt > STALL_MS

    if (!micDead && !recDead && !stalled) {
      if (this.stalled) {
        this.stalled = false
        this.onStateChange?.()
      }
      return
    }
    this.stalled = true
    this.onStateChange?.()
    await this.restartSegment(micDead)
  }

  private async restartSegment(reacquireMic: boolean): Promise<void> {
    if (this.restarting) return
    this.restarting = true
    try {
      await this.sealSegment()
      if (!this.running) return
      if (reacquireMic) {
        let fresh: MediaStream | null = null
        try {
          fresh = await this.getMic()
        } catch {
          fresh = null
        }
        if (!fresh) return // 取り直せない → 次の見張りで再挑戦
        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = fresh
      }
      if (this.stream) {
        this.rec = this.startSegment(this.stream)
        if (this.rec) {
          this.recovered++
          this.stalled = false
          this.onStateChange?.()
        }
      }
    } catch {
      /* 次の見張りで再挑戦 */
    } finally {
      this.restarting = false
    }
  }

  /** 停止して、全セグメントを1本の音声にまとめて返す */
  async stop(): Promise<RecorderResult> {
    const elapsedMs = this.startedAt ? Date.now() - this.startedAt : 0
    this.running = false
    if (this.watchTimer !== null) {
      window.clearInterval(this.watchTimer)
      this.watchTimer = null
    }
    // 録り直しの最中なら終わるまで少し待つ（取りこぼし防止）
    for (let i = 0; i < 30 && this.restarting; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    await this.sealSegment()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null

    const segs = this.segments.filter((b) => b.size > 0)
    this.segments = []
    let blob: Blob | null = null
    if (segs.length === 1) {
      blob = segs[0]
    } else if (segs.length > 1) {
      try {
        blob = await mergeSegmentsToWav(segs)
      } catch {
        // 結合できなければ、いちばん長い（大きい）セグメントを残す。
        // 残りは捨てることになるので、報告に含めて必ず知らせる。
        this.dropped = segs.length - 1
        blob = segs.reduce((a, b) => (b.size > a.size ? b : a), segs[0])
      }
    }
    return {
      blob,
      report: {
        elapsedMs,
        capturedMs: this.capturedMs,
        recovered: this.recovered,
        droppedSegments: this.dropped,
      },
    }
  }
}

/**
 * 複数セグメントを 16kHz モノラル WAV 1本へ結合する。
 * コンテナが別々なので単純連結では再生できないため、デコードして繋ぎ直す。
 */
async function mergeSegmentsToWav(segs: Blob[]): Promise<Blob> {
  const SR = 16000
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  const parts: Int16Array<ArrayBuffer>[] = []
  let frames = 0
  try {
    for (const s of segs) {
      const buf = await ctx.decodeAudioData(await s.arrayBuffer())
      const ch = buf.numberOfChannels > 1 ? mixDown(buf) : buf.getChannelData(0)
      const resampled = resample(ch, buf.sampleRate, SR)
      const pcm = new Int16Array(new ArrayBuffer(resampled.length * 2))
      for (let i = 0; i < resampled.length; i++) {
        const v = Math.max(-1, Math.min(1, resampled[i]))
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
      }
      parts.push(pcm)
      frames += pcm.length
    }
  } finally {
    void ctx.close().catch(() => {})
  }
  if (frames === 0) throw new Error('結合できる音声がありません')
  return wavFromPcm(parts, frames, SR)
}

function mixDown(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < buf.length; i++) out[i] += data[i] / buf.numberOfChannels
  }
  return out
}

function resample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data
  const ratio = from / to
  const len = Math.floor(data.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(data.length - 1, i0 + 1)
    const t = pos - i0
    out[i] = data[i0] * (1 - t) + data[i1] * t
  }
  return out
}

function wavFromPcm(parts: Int16Array<ArrayBuffer>[], frames: number, sampleRate: number): Blob {
  const dataSize = frames * 2
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE')
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true)
  view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, dataSize, true)
  return new Blob([header, ...parts], { type: 'audio/wav' })
}

/** 「経過より音声が短い」ときに出す注意文。問題なければ null。 */
export function shortfallWarning(report: RecorderReport): string | null {
  if (report.elapsedMs < 20_000) return null
  const missing = report.elapsedMs - report.capturedMs
  if (missing < 15_000) return null
  const sec = Math.round(missing / 1000)
  return `録音が${sec}秒ぶん取り込めていません。端末が画面オフ中に録音を止めた可能性があります。認識テキストを確認してください。`
}
