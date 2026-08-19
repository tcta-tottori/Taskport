import { toMono16k } from './audio'

/* =========================================================
 * 端末内 Whisper（あとから高精度で取り直す）
 *
 * 録音中の文字起こしは Web Speech（速いが取りこぼす）。
 * それとは別に、**録音した音声そのもの**をあとから Whisper に通して
 * 精度の高い文字に置き換えられるようにする。NoteLoop 9.2 と同じ組み立て。
 *
 *   録音中  … Web Speech でその場に出す（待たされない）
 *   停止後  … 人が押したときだけ Whisper で取り直す（時間がかかるので自動にしない）
 *
 * 処理はすべて Worker（public/whisper-worker.js）の中で、端末内で完結する。
 * 外へ出るのは「仕組みとモデルを取りに行く」ぶんだけで、音声は出ない。
 *
 * ここは React に依存させない。画面は進み具合を受け取って出すだけにする。
 * =======================================================*/

export type WhisperModelKey = 'tiny' | 'base' | 'small' | 'turbo'

export interface WhisperModel {
  key: WhisperModelKey
  /** Hugging Face のモデルID */
  id: string
  label: string
  /** 初回に取り込む量の目安 */
  size: string
  note: string
}

/**
 * 選べるモデル。大きいほど精度が上がり、そのぶん遅く重い。
 * 既定は base（利用者の指示）。スマホの CPU でも現実的な速さで、
 * Web Speech の取りこぼしを埋める用途には十分。
 */
export const WHISPER_MODELS: WhisperModel[] = [
  {
    key: 'tiny',
    id: 'onnx-community/whisper-tiny',
    label: 'tiny',
    size: '約40MB',
    note: '最速・最軽量。精度は Web Speech より落ちることがある',
  },
  {
    key: 'base',
    id: 'onnx-community/whisper-base',
    label: 'base',
    size: '約80MB',
    note: 'スマホでも現実的な速さ。取りこぼしを埋めるならここで足りる',
  },
  {
    key: 'small',
    id: 'onnx-community/whisper-small',
    label: 'small',
    size: '約250MB',
    note: '精度は上がるが、スマホでは目に見えて遅い',
  },
  {
    key: 'turbo',
    id: 'onnx-community/whisper-large-v3-turbo',
    label: 'large-v3-turbo',
    size: '約1.2GB',
    note: '最高精度。GPUのあるPC向け。スマホでは動かないことがある',
  },
]

export function modelOf(key: string): WhisperModel {
  return WHISPER_MODELS.find((m) => m.key === key) ?? WHISPER_MODELS[1]
}

/** いまの進み具合。画面はこれをそのまま出す。 */
export interface WhisperProgress {
  /** decode=音声の読み込み / load=モデルの取り込み / run=文字起こし */
  stage: 'decode' | 'load' | 'run'
  /** 0〜100。分からないときは null */
  percent: number | null
  /** 「モデルを取り込んでいます（42%）」のような一行 */
  message: string
}

/* ---------------------------------------------------------
 * Worker の口
 * ------------------------------------------------------- */

type WorkerMessage =
  | { type: 'progress'; data: { status?: string; file?: string; progress?: number } }
  | { type: 'fallback'; to: string; message: string }
  | { type: 'result'; id: number; text: string; device: string }
  | { type: 'error'; id: number; message: string }

let worker: Worker | null = null
let seq = 0

function ensureWorker(): Worker {
  if (!worker) {
    // public に置いた素の JS。使うと決めるまで読み込まれない。
    // 配信先はサブパス（/Taskport/）なので、base を必ず通す。
    worker = new Worker(new URL(`${import.meta.env.BASE_URL}whisper-worker.js`, location.origin), {
      type: 'module',
    })
  }
  return worker
}

/**
 * 走らせるバックエンドを決める。
 * 指でさわる端末（スマホ・タブレット）は WASM に固定する。
 * モバイルの WebGPU は Whisper の推論で createBuffer に失敗しやすく、
 * 落ちてからやり直すぶん、はじめから CPU で走らせたほうが速い。
 */
function pickDevice(): 'webgpu' | 'wasm' {
  const touch = window.matchMedia?.('(pointer: coarse)')?.matches ?? false
  const hasWebGPU = 'gpu' in navigator
  return !touch && hasWebGPU ? 'webgpu' : 'wasm'
}

/** 動かせる見込みがあるか（Worker と WebAssembly が使えるか） */
export function whisperSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'
}

/** 人がやめたときに投げる。画面はこれを見て「失敗」と出さない。 */
export class WhisperCancelled extends Error {
  constructor() {
    super('取り直しをやめました')
    this.name = 'WhisperCancelled'
  }
}

/** いま走っているものの打ち切り口。無ければ null */
let cancelCurrent: (() => void) | null = null

/**
 * 録音の音声を文字にする。
 *
 * @param blob     録音した音声
 * @param modelKey 使うモデル（設定が持つ）
 * @param onProgress 進み具合。画面に出すためだけに使う
 */
export async function transcribe(
  blob: Blob,
  modelKey: string,
  onProgress: (p: WhisperProgress) => void,
): Promise<string> {
  const model = modelOf(modelKey)

  onProgress({ stage: 'decode', percent: null, message: '録音を読み込んでいます…' })
  const audio = await toMono16k(blob)

  const w = ensureWorker()
  const id = ++seq
  const device = pickDevice()

  return new Promise<string>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        const pct = typeof msg.data?.progress === 'number' ? Math.round(msg.data.progress) : null
        // status が 'progress' の間はモデルの取り込み中。始まってしまえば推論。
        if (msg.data?.status === 'progress' || msg.data?.status === 'download') {
          onProgress({
            stage: 'load',
            percent: pct,
            message: pct === null ? 'モデルを取り込んでいます…' : `モデルを取り込んでいます（${pct}%）`,
          })
        } else if (msg.data?.status === 'ready' || msg.data?.status === 'done') {
          onProgress({ stage: 'run', percent: null, message: '文字起こししています…' })
        }
        return
      }
      if (msg.type === 'fallback') {
        onProgress({ stage: 'run', percent: null, message: 'GPUが使えないのでCPUで続けます…' })
        return
      }
      if (msg.type === 'result' && msg.id === id) {
        cleanup()
        resolve(msg.text)
        return
      }
      if (msg.type === 'error' && msg.id === id) {
        cleanup()
        // 中身は transformers.js の英語のまま。何が起きたかは日本語で前に付ける
        reject(new Error(`文字起こしに失敗しました: ${msg.message}`))
      }
    }
    const onError = () => {
      cleanup()
      // 読み込みに失敗した Worker は死んでいる。捨てておかないと、
      // 次に押したときに何も返ってこない（押しても無反応に見える）。
      worker?.terminate()
      worker = null
      reject(
        new Error(
          '文字起こしの仕組みを読み込めませんでした。初回はインターネットが要ります。電波の届くところでもう一度試してください。',
        ),
      )
    }
    const cleanup = () => {
      cancelCurrent = null
      w.removeEventListener('message', onMessage as EventListener)
      w.removeEventListener('error', onError as EventListener)
    }
    // 推論の途中では止められないので、打ち切りは Worker を落として行う。
    // 落としただけでは待っている側が返ってこないので、ここで返す。
    cancelCurrent = () => {
      cleanup()
      reject(new WhisperCancelled())
    }

    w.addEventListener('message', onMessage as EventListener)
    w.addEventListener('error', onError as EventListener)

    onProgress({ stage: 'load', percent: null, message: 'モデルを用意しています…' })
    // 音声は所有権ごと渡す（コピーしないぶん、長い録音でも詰まらない）
    w.postMessage({ type: 'transcribe', id, model: model.id, device, audio, language: 'ja' }, [
      audio.buffer,
    ])
  })
}

/**
 * 走っているものを打ち切る。
 * Worker を落とすのが確実（推論の途中では止められない）。次に使うときは作り直す。
 */
export function cancelTranscribe(): void {
  const stop = cancelCurrent
  if (worker) {
    worker.terminate()
    worker = null
  }
  stop?.()
}
