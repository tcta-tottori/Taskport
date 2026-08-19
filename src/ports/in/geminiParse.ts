import { askJson, type OnStage } from '../../lib/gemini'
import { isDayKey, isTimeKey, weekdayLabel } from '../../lib/date'
import { emptyDraft } from '../../lib/tasks'
import { cleanCategories } from '../../lib/workCategories'
import {
  PRIORITIES,
  type CategoryGroup,
  type Draft,
  type Priority,
  type Repeat,
  type RepeatUnit,
  type Source,
} from '../../types'

/* =========================================================
 * 自然文の構造化（Gemini）
 *
 * `localParse` と同じ仕事をする、もう一つの読み手。
 * どちらを使っても出口は `Draft[]` で、**必ず確認画面を通る**。
 * 無確認で保存する経路はここからも生やさない（CLAUDE.md §3.3）。
 *
 * **文章が Google のサーバへ出る。** 設定でキーを入れ、
 * 「文章の解析にGeminiを使う」を入れたときだけ通る道（design.md §10.1）。
 *
 * 返ってきた JSON は信用しない。日付・時刻・優先度・繰り返しは
 * すべて形を確かめてから Draft に入れる（型が違えば捨てる）。
 * =======================================================*/

const REPEAT_UNITS: RepeatUnit[] = ['day', 'workday', 'week', 'month', 'monthEnd']

/** 送る指示。読み取りの決まりは localParse と同じにそろえる。 */
function buildPrompt(text: string, today: string, groups: CategoryGroup[]): string {
  const master = groups.flatMap((g) => g.items).slice(0, 120).join('、')
  return [
    'あなたは製造業の生産管理担当者のメモを、タスクの一覧に直す担当です。',
    `今日は ${today}（${weekdayLabel(today)}曜日）です。`,
    '',
    '次の文章から、実行すべき仕事を取り出し、JSON の配列だけを返してください。',
    '配列の各要素は次の形にしてください。',
    '{"title":string,"note":string,"due":string|null,"dueTime":string|null,' +
      '"estimateMin":number|null,"priority":"high"|"mid"|"low","categories":string[],' +
      '"repeat":null|{"unit":"day"|"workday"|"week"|"month"|"monthEnd","weekdays":number[],"until":string|null}}',
    '',
    '決まり:',
    '- title は「〜する」で終わる実行形にし、期限や優先度を表す語は残さない',
    '- 1つの用件につき1件。実行内容が読み取れない断片は捨てる',
    '- due は "YYYY-MM-DD"。「明日」「来週月曜」「今月末」は今日を基準に実日付へ直す',
    '- **期限の言及が無ければ due は null。推測で日付を入れない**',
    '- dueTime は "HH:mm"。時刻の言及が無ければ null',
    '- priority は「至急」「今日中」なら high、数日以内の期限があれば mid、それ以外は low',
    `- categories は次の語からだけ選ぶ（当てはまらなければ空配列。最大2つ）: ${master}`,
    '- repeat は「毎日」「毎週◯曜」「毎月末」のように、回りかたを明確に言っているときだけ。' +
      '「定期的に」は拾わない。weekdays は 0=日〜6=土',
    '- 相手先・数量・背景は note に入れる',
    '- 説明や前置きを付けず、JSON の配列だけを返す',
    '',
    '文章:',
    text,
  ].join('\n')
}

function toRepeat(raw: unknown): Repeat | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (!REPEAT_UNITS.includes(o.unit as RepeatUnit)) return null
  const weekdays = Array.isArray(o.weekdays)
    ? o.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    : []
  return { unit: o.unit as RepeatUnit, weekdays, until: isDayKey(o.until) ? o.until : null }
}

/** 返ってきた1件を Draft にする。形が合わないものは null にして捨てる。 */
function toDraft(raw: unknown, source: Source): Draft | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (title.length < 2) return null
  const est = typeof o.estimateMin === 'number' && o.estimateMin > 0 ? Math.round(o.estimateMin) : null
  return {
    ...emptyDraft(source),
    title,
    note: typeof o.note === 'string' ? o.note.trim() : '',
    due: isDayKey(o.due) ? o.due : null,
    dueTime: isTimeKey(o.dueTime) ? o.dueTime : null,
    estimateMin: est,
    priority: PRIORITIES.includes(o.priority as Priority) ? (o.priority as Priority) : 'mid',
    categories: Array.isArray(o.categories)
      ? cleanCategories(o.categories.filter((c): c is string => typeof c === 'string')).slice(0, 2)
      : [],
    repeat: toRepeat(o.repeat),
  }
}

/**
 * Gemini に文章を渡してタスク候補にする。
 * 1件も取れなかったときは空配列を返し、呼び出し側が端末内の解析へ落とす。
 */
export async function geminiParse(
  text: string,
  source: Source,
  today: string,
  groups: CategoryGroup[],
  model: string,
  onStage: OnStage,
): Promise<Draft[]> {
  onStage('Geminiに文章を送っています…')
  const data = await askJson(buildPrompt(text, today, groups), model, onStage)
  // 配列で返るはずだが、{tasks:[...]} の形で返してくることもある
  const arr = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { tasks?: unknown[] }).tasks)
      ? ((data as { tasks: unknown[] }).tasks)
      : []
  const drafts: Draft[] = []
  for (const item of arr) {
    const d = toDraft(item, source)
    if (d) drafts.push(d)
  }
  return drafts
}
