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
  | 'share'
  | 'band'
  | 'catTime'
  | 'trend'
  | 'hero'
  | 'effort'
  | 'jobs'
  | 'estimate'
  | 'weekday'
  | 'progress'
  | 'priority'
  | 'source'

/** 面の見出し。カタカナ、無ければ漢字（v1.26.0。利用者の指示） */
export const DASH_LABEL: Record<DashCard, string> = {
  share: '区分の割合',
  band: '時間帯',
  catTime: '区分ごとの時間',
  trend: '推移',
  hero: '稼働',
  effort: '作業ごとの工数',
  jobs: '案件ごとの工数',
  estimate: '見込みと実績',
  weekday: '曜日ごと',
  progress: '区分別の進捗',
  priority: '優先度',
  source: '入口別',
}

/**
 * 既定の並び。
 * 上の4つ（区分の割合・時間帯・区分ごとの時間・推移）は利用者の指示（v1.30.0）。
 * そのあとに「どれだけ働いたか」→「何にかかったか」→「台帳の偏り」を置く。
 */
export const DEFAULT_DASH_ORDER: DashCard[] = [
  'share',
  'band',
  'catTime',
  'trend',
  'hero',
  'effort',
  'jobs',
  'estimate',
  'weekday',
  'progress',
  'priority',
  'source',
]

/**
 * 保存された並びを、いまあるカードに合わせて整える。
 *
 * 面が増えたときは**既定の並びに戻す**（v1.30.0）。
 * 欠けたぶんを後ろへ足すだけだと、増えた面がいつも最後に付き、
 * 並びを決め直した意味が消える（利用者が並べ替え直すまで古い並びのまま）。
 * 並べ替えは画面からいつでもやり直せる。
 */
export function normalizeDashOrder(saved: readonly string[] | undefined): DashCard[] {
  const known = new Set<string>(DEFAULT_DASH_ORDER)
  const out: DashCard[] = []
  for (const key of saved ?? []) {
    if (known.has(key) && !out.includes(key as DashCard)) out.push(key as DashCard)
  }
  if (out.length < DEFAULT_DASH_ORDER.length) return DEFAULT_DASH_ORDER
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
