import { dayKey, isDayKey, isTimeKey, weekdayLabel } from '../../lib/date'
import { ulid } from '../../lib/ulid'
import { localParse } from './localParse'
import { PRIORITIES, type Draft, type Priority, type Source } from '../../types'

/* =========================================================
 * 構造化パイプライン（共通）
 *
 * 音声・キーボード・共有、どの入口から来た自然文もここに集約する。
 * 入口ごとに別々の解析処理を書かない。
 *
 * 出てきた Draft[] は必ず確認画面（ReviewSheet）に出す。
 * 無確認で登録する経路をここから生やさないこと。
 * =======================================================*/

const TIMEOUT_MS = 20_000

export type ParseEngine = 'ai' | 'local'

export interface ParseResult {
  drafts: Draft[]
  /** どちらの経路で解釈したか。画面に出して、利用者が結果の精度を判断できるようにする */
  engine: ParseEngine
  /** AI 経路が失敗してローカルに落ちたときの理由（画面に出す） */
  fallbackReason?: string
}

/** ビルド時に埋めた既定のプロキシURL。設定画面の値があればそちらを優先する。 */
const BUILT_IN_ENDPOINT: string = import.meta.env.VITE_PARSE_ENDPOINT ?? ''

export function resolveEndpoint(fromSettings: string): string {
  return (fromSettings || BUILT_IN_ENDPOINT).trim()
}

/** ```json フェンスを外して中身だけにする */
function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (m ? m[1] : text).trim()
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/**
 * AI の返り値は信用しない。1件ずつ検証して、不正なら安全側へ倒す。
 *   due      … "YYYY-MM-DD" でなければ null
 *   dueTime  … "HH:mm" でなければ null
 *   priority … 列挙値になければ "mid"
 */
function toDraft(raw: unknown, source: Source): Draft | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const title = asString(o.title).trim()
  if (!title) return null

  const due = isDayKey(o.due) ? o.due : null
  const dueTime = isTimeKey(o.dueTime) ? o.dueTime : null
  const priority: Priority = PRIORITIES.includes(o.priority as Priority)
    ? (o.priority as Priority)
    : 'mid'
  const est = typeof o.estimateMin === 'number' && o.estimateMin > 0 ? Math.round(o.estimateMin) : null

  return {
    tempId: ulid(),
    title,
    note: asString(o.note).trim(),
    due,
    dueTime,
    estimateMin: est,
    priority,
    category: asString(o.category).trim(),
    source,
  }
}

function parseDrafts(text: string, source: Source): Draft[] {
  const body = stripFence(text)
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    // JSON にならなかったら呼び出し側でローカル解析に落とす
    throw new Error('AIの返答をJSONとして読めませんでした')
  }
  const arr = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { tasks?: unknown }).tasks)
      ? ((data as { tasks: unknown[] }).tasks)
      : null
  if (!arr) throw new Error('AIの返答がタスクの配列ではありませんでした')
  return arr.map((r) => toDraft(r, source)).filter((d): d is Draft => d !== null)
}

/**
 * 自然文をタスク候補に分解する。
 *
 * プロキシが設定されていれば AI へ、無い／失敗したら端末内のかんたん解析へ。
 * どちらの経路でも戻り値の形は同じで、確認画面の作りは変わらない。
 */
export async function parseToTasks(
  text: string,
  source: Source,
  options: { endpoint?: string; today?: string } = {},
): Promise<ParseResult> {
  const body = text.trim()
  const today = options.today ?? dayKey()
  if (!body) return { drafts: [], engine: 'local' }

  const endpoint = resolveEndpoint(options.endpoint ?? '')
  if (!endpoint) {
    return {
      drafts: localParse(body, source, today),
      engine: 'local',
      fallbackReason: 'AI構造化プロキシが未設定です。設定画面でURLを登録すると精度が上がります。',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 相対表現の変換に必要なので、今日の日付と曜日を必ず渡す
      body: JSON.stringify({ text: body, today, weekday: weekdayLabel(today) }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`AI構造化に失敗しました（HTTP ${res.status}）`)
    const payload: unknown = await res.json()
    const content =
      typeof payload === 'object' && payload !== null && 'content' in payload
        ? asString((payload as { content: unknown }).content)
        : JSON.stringify(payload)
    const drafts = parseDrafts(content, source)
    if (drafts.length === 0) throw new Error('AIがタスクを1件も取り出せませんでした')
    return { drafts, engine: 'ai' }
  } catch (err) {
    const reason =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'AIの応答が20秒以内に返りませんでした'
        : err instanceof Error
          ? err.message
          : 'AI構造化に失敗しました'
    return {
      drafts: localParse(body, source, today),
      engine: 'local',
      fallbackReason: `${reason}。端末内のかんたん解析で候補を作りました。内容を確認してください。`,
    }
  } finally {
    clearTimeout(timer)
  }
}
