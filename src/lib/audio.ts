/* =========================================================
 * 録音した音声を、文字起こしに渡せる形にする
 *
 * Whisper が受け取るのは 16kHz・モノラルの生の波形（Float32Array）。
 * 録音は端末の都合で m4a だったり webm だったりするので、
 * ここで一度デコードして、決まった形に揃える。
 *
 * 端末の中だけで完結する処理で、外へは何も送らない。
 * =======================================================*/

/** Whisper が前提にしているサンプリング周波数 */
export const WHISPER_RATE = 16000

/**
 * 録音の Blob を 16kHz モノラルの波形にする。
 *
 * `decodeAudioData` は渡した ArrayBuffer を使えなくする（detach）ので、
 * 呼ぶ側で同じバッファを使い回さないこと。
 */
export async function toMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()

  // デコードは端末の対応形式に任せる（m4a / webm / wav のどれでも通る）
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(buf)
  } finally {
    void ctx.close()
  }

  const frames = Math.max(1, Math.round((decoded.duration * WHISPER_RATE) || 1))
  // 1本（モノラル）に混ぜながら 16kHz へ落とす。
  // 自前で間引かずに OfflineAudioContext に任せるのは、
  // 単純な間引きだと折り返し雑音が乗って認識が落ちるため。
  const off = new OfflineAudioContext(1, frames, WHISPER_RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const out = await off.startRendering()
  return out.getChannelData(0)
}

/** 波形の長さ（秒）。進み具合の見込みを出すのに使う。 */
export function secondsOf(audio: Float32Array): number {
  return audio.length / WHISPER_RATE
}

/**
 * 16kHz モノラルの波形を WAV（16bit PCM）にする。
 *
 * 外へ送るときの形式をここに揃える。録音そのものは端末によって
 * m4a だったり webm だったりして、受け取る側が扱えないことがあるため。
 */
export function toWav16k(audio: Float32Array): Blob {
  const frames = audio.length
  const buf = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buf)
  const ws = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i))
  }
  ws(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  ws(8, 'WAVE')
  ws(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, WHISPER_RATE, true)
  view.setUint32(28, WHISPER_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ws(36, 'data')
  view.setUint32(40, frames * 2, true)
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, audio[i]))
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}
