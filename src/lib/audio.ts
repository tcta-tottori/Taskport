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
