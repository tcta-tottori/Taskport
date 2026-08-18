import { toMono16k, toWav16k } from './audio'

/* =========================================================
 * Gemini（利用者が自分のAPIキーを入れて使う）
 *
 * **ここは外へデータを出す経路。** 音声も文章も Google のサーバへ渡る。
 * 利用者の判断で v1.17.0 に足した（design.md §10.1）。守ること:
 *
 *   1. **キーを入れるまで動かない。** 既定は空で、入口も出てこない
 *   2. **押したときだけ送る。** 自動で送る経路を作らない
 *   3. **送る前に画面へ書く。** 何が出ていくのかをボタンの近くに書く
 *   4. **キーは端末内（localStorage）だけ。** 同期にも書き出しにも乗せない
 *
 * 端末内で完結する道（Web Speech・端末内Whisper・localParse）は残す。
 * こちらは選べる相手が増えただけで、置き換えではない。
 *
 * 組み立ては NoteLoop 9.2 に合わせてある（同じキー・同じ無料枠を使うため、
 * 通るモデルと落ち方の癖をそろえておくほうが迷わない）。
 * =======================================================*/

const KEY_STORAGE = 'taskport_gemini_key'
const BASE = 'https://generativelanguage.googleapis.com'

/** inline で送れる上限。これを超えるものは断る（Files API は持たない） */
const INLINE_LIMIT = 18 * 1024 * 1024
/** 16kHz・モノラル・16bit で 18MB になる長さ（秒） */
export const MAX_AUDIO_SEC = Math.floor(INLINE_LIMIT / (16000 * 2))

export interface GeminiModel {
  id: string
  label: string
  note: string
}

/**
 * 選べるモデル。
 * 既定は「無料枠で実際に通るもの」を選ぶ（NoteLoop で確かめた並び）。
 * 無料枠に割り当てが無いモデルは、請求先を設定していないと必ず 429 で落ちる。
 */
export const GEMINI_MODELS: GeminiModel[] = [
  { id: 'gemini-3.5-flash', label: 'flash', note: '速くて無料枠で通る。ふだんはこれで足りる' },
  { id: 'gemini-3.1-flash-lite', label: 'flash-lite', note: 'さらに軽い。枠を使い切りたくないとき' },
]

export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0].id

/** 選んだモデルが使えないときに、順に試す相手 */
const FALLBACKS = GEMINI_MODELS.map((m) => m.id)

/** 待てば通ることが多いもの。同じモデルで少し粘る */
const TRANSIENT = [500, 502, 503, 504]
const MAX_RETRY = 2
const TIMEOUT_MS = 120_000

/* ---------------------------------------------------------
 * APIキー（端末内にのみ置く）
 * ------------------------------------------------------- */

export function loadKey(): string {
  try {
    return (localStorage.getItem(KEY_STORAGE) ?? '').trim()
  } catch {
    return ''
  }
}

export function saveKey(key: string): void {
  const k = key.trim()
  if (k) localStorage.setItem(KEY_STORAGE, k)
  else localStorage.removeItem(KEY_STORAGE)
}

export function hasKey(): boolean {
  return loadKey().length > 0
}

/**
 * キーの形。AI Studio は「AIza…」（39文字）と「AQ.…」（53文字）を出す。
 * どちらも有効なので両方通す。
 */
export function isLikelyKey(k: string): boolean {
  return /^AIza[\w-]{10,}$/.test(k) || /^AQ\.[\w.-]{10,}$/.test(k)
}

/**
 * いま入っているキーの形を、値そのものを出さずに説明する。
 * 画面の省略表示をそのまま貼ってしまう取り違えが多いので、長さで気づけるようにする。
 */
export function keyShape(): string {
  const k = loadKey()
  if (!k) return ''
  const expect = k.startsWith('AIza') ? 39 : k.startsWith('AQ.') ? 53 : 0
  const shape = `${k.length}文字・${k.slice(0, 6)}…${k.slice(-4)}`
  if (expect && k.length < expect) return `${shape}（本来は${expect}文字。途中で切れています）`
  if (expect && k.length > expect) return `${shape}（本来は${expect}文字。余分な文字が入っています）`
  return shape
}

/* ---------------------------------------------------------
 * 呼び出し
 * ------------------------------------------------------- */

/** 何をしているかを画面に出すための合図 */
export type OnStage = (message: string) => void

export class GeminiNoKey extends Error {
  constructor() {
    super('GeminiのAPIキーが入っていません。設定画面で入れてください。')
    this.name = 'GeminiNoKey'
  }
}

interface Part {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

function messageFor(status: number, detail: string, model: string): string {
  if (status === 400) return `Geminiが受け付けませんでした（400）。APIキーが正しいか設定画面で確かめてください。${detail}`
  if (status === 401 || status === 403)
    return 'GeminiのAPIキーが使えませんでした。設定画面でキーを入れ直してください。'
  if (status === 404) return `${model} は使えませんでした（404）。設定画面で別のモデルを選んでください。`
  if (status === 429)
    return 'Geminiの無料枠を使い切りました。しばらく待つか、設定画面で軽いモデルに変えてください。'
  return `Geminiから応答がありませんでした（${status}）。${detail}`
}

async function post(model: string, parts: Part[], key: string, json: boolean): Promise<Response> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      }),
      signal: ctrl.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 1回の問い合わせ。
 * 選んだモデルが使えない（404/429）ときは別のモデルへ、
 * 混んでいるだけ（5xx）のときは間を空けて同じモデルへ、順にやり直す。
 */
async function ask(parts: Part[], model: string, onStage: OnStage, json: boolean): Promise<string> {
  const key = loadKey()
  if (!key) throw new GeminiNoKey()

  const tried: string[] = []
  let last: Error | null = null

  for (const m of [model, ...FALLBACKS]) {
    if (tried.includes(m)) continue
    tried.push(m)
    if (tried.length > 1) onStage(`${m} で試しています…`)

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await post(m, parts, key, json)
      } catch (err) {
        // 通信そのものが届かなかった（圏外・打ち切り）
        last = new Error(
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Geminiの応答が長すぎるので打ち切りました。録音が長いときは端末内の文字起こしをお使いください。'
            : 'Geminiにつながりませんでした。電波の届くところで試してください。',
        )
        break
      }

      if (res.ok) {
        const data: unknown = await res.json()
        return textOf(data)
      }

      let detail = ''
      try {
        const e = (await res.json()) as { error?: { message?: string } }
        detail = e.error?.message ?? ''
      } catch {
        /* 本文が読めないこともある。状態だけで案内する */
      }
      last = new Error(messageFor(res.status, detail, m))

      if (TRANSIENT.includes(res.status) && attempt < MAX_RETRY) {
        const wait = 2000 * 2 ** attempt
        onStage(`Geminiが混み合っています。${Math.round(wait / 1000)}秒待って試します…`)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      // キーの誤りや不正な要求は、モデルを変えても直らない
      if (res.status === 400 || res.status === 401 || res.status === 403) throw last
      break
    }
  }
  throw last ?? new Error('Geminiを呼べませんでした。')
}

/** 応答から本文だけを取り出す。形が違えば空文字。 */
function textOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const cand = (data as { candidates?: unknown[] }).candidates?.[0]
  if (typeof cand !== 'object' || cand === null) return ''
  const parts = (cand as { content?: { parts?: unknown[] } }).content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((p) => (typeof p === 'object' && p !== null ? ((p as { text?: string }).text ?? '') : ''))
    .join('')
    .trim()
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('音声を読み込めませんでした。'))
    r.readAsDataURL(blob)
  })
}

/**
 * 録音した音声を Gemini に送って文字にする。
 * **音声そのものが端末から出る。** 押されたときだけ呼ぶこと。
 */
export async function transcribeAudio(blob: Blob, model: string, onStage: OnStage): Promise<string> {
  if (!hasKey()) throw new GeminiNoKey()

  onStage('音声を用意しています…')
  // 端末によって m4a だったり webm だったりするので、受け取れる形に揃える
  const wav = toWav16k(await toMono16k(blob))
  if (wav.size > INLINE_LIMIT) {
    throw new Error(
      `録音が長すぎて送れません（${Math.floor(MAX_AUDIO_SEC / 60)}分まで）。端末内のWhisperで取り直してください。`,
    )
  }

  onStage('Geminiへ音声を送っています…')
  const data = await toBase64(wav)
  const text = await ask(
    [
      {
        text:
          '次の音声を日本語で文字起こししてください。' +
          '話した内容だけを、聞こえたとおりに書いてください。' +
          '要約・言い換え・前置き・見出しは付けないでください。',
      },
      { inlineData: { mimeType: 'audio/wav', data } },
    ],
    model,
    onStage,
    false,
  )
  if (!text) throw new Error('Geminiから文字が返りませんでした。もう一度試してください。')
  return text
}

/** 文章を送って、JSON で返してもらう。中身の検証は呼び出し側で行う。 */
export async function askJson(prompt: string, model: string, onStage: OnStage): Promise<unknown> {
  const text = await ask([{ text: prompt }], model, onStage, true)
  try {
    // ```json で囲って返してくることがあるので、その分だけ剥がす
    const body = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    return JSON.parse(body) as unknown
  } catch {
    throw new Error('Geminiの返事を読み取れませんでした。もう一度試してください。')
  }
}
