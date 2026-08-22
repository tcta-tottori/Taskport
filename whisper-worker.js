/* =========================================================
 * 端末内 Whisper（NoteLoop 9.2 の worker.js と同じ作り）
 *
 * 録音した音声を**この Worker の中だけ**で文字にする。
 * 外部の文字起こしサービスへは送らない（CLAUDE.md §3.1）。
 * 取りに行くのは「仕組み（transformers.js）」と「モデル」だけで、
 * 音声そのものは端末から出ない。
 *
 * バンドルに混ぜず public に素の JS で置いてあるのは、
 *   - onnxruntime の .wasm をどこから配るかを自前で面倒みなくて済む
 *     （CDN から入れると、同じ CDN の中で解決される）
 *   - 使うと決めるまで 1 バイトも読み込まれない
 *   - npm の依存が増えない（CLAUDE.md §2「依存は最小に保つ」）
 * ため。版はここに固定してあるので、勝手に上がらない。
 * =======================================================*/
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1'

// 端末内のファイルを探しに行かせない（モデルはCDNから取る）
env.allowLocalModels = false

/** モデル×バックエンドごとに作ったものを取っておく（二度目からは待たない） */
const cache = new Map()
const keyFor = (model, device) => `${device}::${model}`

/**
 * バックエンドごとの量子化。
 * WebGPU はデコーダを q8 にすると文字化けする既知の不具合があるので、
 * エンコーダ fp32 ＋ デコーダ q4 にする（transformers.js #1317）。
 * WASM（CPU）は q8 で十分で、そのぶん軽い。
 */
function dtypeFor(device) {
  if (device === 'webgpu') return { encoder_model: 'fp32', decoder_model_merged: 'q4' }
  return 'q8'
}

/** 組み立てる。WebGPU で失敗したら WASM に落とす。 */
async function load(model, device, onProgress) {
  const key = keyFor(model, device)
  if (!cache.has(key)) {
    cache.set(
      key,
      pipeline('automatic-speech-recognition', model, {
        device,
        dtype: dtypeFor(device),
        progress_callback: onProgress,
      }),
    )
  }
  try {
    return { pipe: await cache.get(key), device }
  } catch (err) {
    cache.delete(key) // 失敗は覚えない（次にやり直せるように）
    if (device === 'webgpu') {
      self.postMessage({ type: 'fallback', to: 'wasm', message: String(err?.message ?? err) })
      return load(model, 'wasm', onProgress)
    }
    throw err
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {}
  const device = msg.device === 'webgpu' ? 'webgpu' : 'wasm'
  const onProgress = (p) => self.postMessage({ type: 'progress', data: p })

  if (msg.type !== 'transcribe') return

  const options = {
    task: 'transcribe',
    language: msg.language || 'ja',
    // 「このように…」の暴走（無音での反復）を抑える
    no_repeat_ngram_size: 3,
    repetition_penalty: 1.15,
  }

  // 30秒を超えるものだけ、重なりを付けて刻む。
  // 短いものは刻まないほうが安定する。
  const sec = (msg.audio?.length ?? 0) / 16000
  if (sec > 28) {
    options.chunk_length_s = 30
    options.stride_length_s = 5
    options.return_timestamps = true
  }

  // WebGPU で走らせるときは、落ちたときに WASM でやり直せるよう控えを取る
  const backup = device === 'webgpu' ? msg.audio.slice() : null

  const run = async (dev, audio) => {
    const { pipe, device: used } = await load(msg.model, dev, onProgress)
    const out = await pipe(audio, options)
    return { text: (out?.text ?? '').trim(), used }
  }

  try {
    let res
    try {
      res = await run(device, msg.audio)
    } catch (err) {
      if (device !== 'webgpu') throw err
      self.postMessage({ type: 'fallback', to: 'wasm', message: String(err?.message ?? err) })
      res = await run('wasm', backup || msg.audio)
    }
    self.postMessage({ type: 'result', id: msg.id, text: res.text, device: res.used })
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err?.message ?? err) })
  }
}
