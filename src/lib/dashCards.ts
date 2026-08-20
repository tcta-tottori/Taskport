import type { DaySegment } from './worklog'

/* =========================================================
 * 分析の面（カード）の並び
 *
 * 何をいちばん上に置きたいかは人と時期で変わるので、**並びは設定が持つ**。
 * コードが持つのは「どんなカードがあるか」と「既定の並び」だけ。
 *
 * 保存された並びは、カードが増えたり消えたりしても壊れないように、
 * 画面に出す前に `normalizeDashOrder` を通す。
 * =======================================================*/

export type DashCard =
  | 'hero'
  | 'band'
  | 'share'
  | 'catTime'
  | 'progress'
  | 'trend'
  | 'priority'
  | 'source'

export const DASH_LABEL: Record<DashCard, string> = {
  hero: '本日の稼働',
  band: '時間帯',
  share: 'その日の区分の割合',
  catTime: '区分ごとの時間',
  progress: '区分ごとの進み具合',
  trend: '処理の推移',
  priority: '未完了の優先度分布',
  source: 'どの入口から入ったか',
}

/**
 * 既定の並び。
 * 上から「今日どうだったか」→「その日の中身」→「積み重ね」の順。
 */
export const DEFAULT_DASH_ORDER: DashCard[] = [
  'hero',
  'band',
  'share',
  'catTime',
  'progress',
  'trend',
  'priority',
  'source',
]

/** 保存された並びを、いまあるカードに合わせて整える（欠けは既定の位置に足す） */
export function normalizeDashOrder(saved: readonly string[] | undefined): DashCard[] {
  const known = new Set<string>(DEFAULT_DASH_ORDER)
  const out: DashCard[] = []
  for (const key of saved ?? []) {
    if (known.has(key) && !out.includes(key as DashCard)) out.push(key as DashCard)
  }
  for (const key of DEFAULT_DASH_ORDER) if (!out.includes(key)) out.push(key)
  return out
}

/** 1つを上（-1）か下（+1）へ動かした並びを返す。端では動かさない。 */
export function moveCard(order: DashCard[], key: DashCard, step: -1 | 1): DashCard[] {
  const at = order.indexOf(key)
  const to = at + step
  if (at < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  next[at] = next[to]
  next[to] = key
  return next
}

/** 時間帯の区間を、始まりの早い順に並べ替える（一覧に出すとき用） */
export function byStart(segments: DaySegment[]): DaySegment[] {
  return [...segments].sort((a, b) => a.from - b.from || a.to - b.to)
}
