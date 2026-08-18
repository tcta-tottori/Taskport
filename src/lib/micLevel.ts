/* =========================================================
 * マイクの音量を測る
 *
 * v1.8.0 まで、録音中のゲージは「音声認識が結果を返したら 0.85 にする」
 * だけで動かしていた。認識が返ってこない場面（通信が細い・認識が非対応・
 * 黙って喋り始めた直後）ではゲージが伸びず、止まって見えていた。
 *
 * ここでは録音に使っているマイクの流れをそのまま分岐させ、
 * 実際の音の大きさ（RMS）を測る。喋っていれば必ず動く。
 *
 * 音は外へ出さない。測るだけで、どこへも送らないし残さない。
 * =======================================================*/

export interface MicLevel {
  /** いまの大きさ 0〜1 */
  value(): number
  stop(): void
}

type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * マイクの流れから音量を測り続ける。
 * 使えない環境（Web Audio が無い・分岐に失敗）では null を返し、
 * 呼び出し側は今までどおり認識の合図で動かす。
 */
export function startMicLevel(stream: MediaStream): MicLevel | null {
  const Ctor = audioCtor()
  if (!Ctor) return null

  let ctx: AudioContext
  try {
    ctx = new Ctor()
  } catch {
    return null
  }

  let raf: number | null = null
  let level = 0
  let stopped = false

  try {
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    // 細かすぎると重く、粗すぎると反応が鈍い。声の上下を拾える程度に取る。
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.1
    source.connect(analyser)
    // 出力へは繋がない（繋ぐと自分の声がそのまま鳴る）

    const buf = new Float32Array(analyser.fftSize)

    const tick = () => {
      if (stopped) return
      raf = requestAnimationFrame(tick)
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      // 生の RMS は小さい値に偏るので、聞こえ方に近い曲げ方をして 0〜1 に伸ばす。
      // 静かな部屋の暗騒音（おおむね 0.005 未満）は切り捨てる。
      const shaped = rms <= 0.005 ? 0 : Math.min(1, Math.pow(rms * 7.5, 0.62))
      // 上がるのは速く、下がるのは少しゆっくり（声の切れ目でがたつかせない）
      level += (shaped - level) * (shaped > level ? 0.55 : 0.18)
    }
    tick()
  } catch {
    try {
      void ctx.close()
    } catch {
      /* noop */
    }
    return null
  }

  // 端末によっては止まった状態で作られるので、起こしておく
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})

  return {
    value: () => level,
    stop() {
      stopped = true
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
      try {
        void ctx.close()
      } catch {
        /* 既に閉じている */
      }
    },
  }
}
