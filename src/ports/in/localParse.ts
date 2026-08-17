import { addDaysKey, dayKey, isDayKey, parseDayKey, weekdayLabel } from '../../lib/date'
import { emptyDraft } from '../../lib/tasks'
import type { Draft, Priority, Source } from '../../types'

/* =========================================================
 * 端末内のかんたん解析（AIプロキシが無い / 届かないときの受け皿）
 *
 * AI ほど賢くはないが、「明日」「至急」「14時」程度は拾える。
 * 出力は AI と同じ Draft[] で、同じ確認画面（ReviewSheet）を通る。
 * つまり無確認で登録されることはこちらの経路でも起きない。
 * =======================================================*/

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const HIGH_WORDS = ['至急', '大至急', '今日中', '本日中', '最優先', '急ぎ', 'すぐに', '即']
const CATEGORY_RULES: { key: string; words: string[] }[] = [
  { key: '発注', words: ['発注', '注文', '手配', '購買'] },
  { key: '納期確認', words: ['納期', '注残', '前倒し', '遅延', '出荷'] },
  { key: '在庫', words: ['在庫', '棚卸', '欠品', '引当'] },
  { key: '会議', words: ['会議', '打合せ', '打ち合わせ', 'ミーティング', '朝会', '面談'] },
  { key: '社内資料', words: ['資料', '稟議', '報告書', '議事録', '日報', '作成'] },
  { key: '通関', words: ['通関', 'インボイス', '船積', 'B/L', '輸出', '輸入'] },
  { key: '連絡', words: ['連絡', '電話', 'メール', '返信', '回答', '確認'] },
]

/** 文の切れ目で分ける。箇条書きの行頭記号も切れ目として扱う。 */
function splitSentences(text: string): string[] {
  return text
    .split(/[\n\r]+/)
    .flatMap((line) => line.split(/(?<=[。．！？!?])/))
    .map((s) => s.replace(/^[\s・\-*•>＞\d]+[.)．）]?\s*/, '').trim())
    .filter((s) => s.length > 0)
}

/**
 * 曜日指定を日付に変換する。
 *   nextWeek=false … 次にその曜日が来る日。同じ曜日を指したら翌週
 *                     （includeToday=true のときだけ今日を許す）
 *   nextWeek=true  … 来週（次の月曜から始まる週）のその曜日
 */
function weekdayTarget(today: string, wd: number, nextWeek: boolean, includeToday = false): string {
  const base = parseDayKey(today).getDay() // 0=日
  if (nextWeek) {
    // 次の月曜まで（今日が月曜なら7日後）
    const toNextMonday = ((7 - base) % 7) + 1
    // 月曜起点での曜日オフセット（月=0 … 日=6）
    const offset = (wd + 6) % 7
    return addDaysKey(today, toNextMonday + offset)
  }
  let delta = (wd - base + 7) % 7
  if (delta === 0 && !includeToday) delta = 7
  return addDaysKey(today, delta)
}

function endOfMonth(today: string): string {
  const d = parseDayKey(today)
  return dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))
}

/** 文の中から期限らしき日付を1つ拾う */
export function extractDue(sentence: string, today: string): string | null {
  const s = sentence

  // 「2026-08-20」形式がそのまま書かれている
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso && isDayKey(iso[0])) return iso[0]

  // 「8月20日」「8/20」
  const md = s.match(/(\d{1,2})\s*[月\/]\s*(\d{1,2})\s*日?/)
  if (md) {
    const m = Number(md[1])
    const d = Number(md[2])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const base = parseDayKey(today)
      let y = base.getFullYear()
      let cand = dayKey(new Date(y, m - 1, d, 12))
      // 過ぎた日付を書いたときは来年ではなく今年のままにする（誤登録より超過表示の方が安全）
      if (cand < today && base.getMonth() === 11 && m === 1) {
        y += 1
        cand = dayKey(new Date(y, m - 1, d, 12))
      }
      return cand
    }
  }

  if (/(今日|本日|今日中|本日中)/.test(s)) return today
  if (/(明日|あした|あす)/.test(s)) return addDaysKey(today, 1)
  if (/(明後日|あさって)/.test(s)) return addDaysKey(today, 2)
  if (/今月末|月末/.test(s)) return endOfMonth(today)
  if (/今週末|週末/.test(s)) return weekdayTarget(today, 6, false, true)

  const nDays = s.match(/(\d{1,2})\s*日後/)
  if (nDays) return addDaysKey(today, Number(nDays[1]))

  const wd = s.match(/(来週|今週|再来週)?\s*([日月火水木金土])曜/)
  if (wd) {
    const idx = WEEKDAYS.indexOf(wd[2])
    if (idx >= 0) {
      if (wd[1] === '再来週') return addDaysKey(weekdayTarget(today, idx, true), 7)
      return weekdayTarget(today, idx, wd[1] === '来週', wd[1] === '今週')
    }
  }

  if (/来週/.test(s)) return addDaysKey(today, 7)
  if (/再来週/.test(s)) return addDaysKey(today, 14)
  return null
}

/** 文の中から時刻を1つ拾う */
export function extractTime(sentence: string): string | null {
  const colon = sentence.match(/(?:^|[^\d:])([0-2]?\d):([0-5]\d)/)
  if (colon) {
    const h = Number(colon[1])
    if (h <= 23) return `${String(h).padStart(2, '0')}:${colon[2]}`
  }
  const half = sentence.match(/([0-2]?\d)\s*時\s*半/)
  if (half) {
    const h = Number(half[1])
    if (h <= 23) return `${String(h).padStart(2, '0')}:30`
  }
  const jp = sentence.match(/([0-2]?\d)\s*時\s*(?:(\d{1,2})\s*分)?/)
  if (jp) {
    const h = Number(jp[1])
    const m = jp[2] ? Number(jp[2]) : 0
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return null
}

function detectPriority(sentence: string, due: string | null, today: string): Priority {
  if (HIGH_WORDS.some((w) => sentence.includes(w))) return 'high'
  if (!due) return 'low'
  const diff = (parseDayKey(due).getTime() - parseDayKey(today).getTime()) / 86_400_000
  if (diff <= 3) return 'mid'
  return 'low'
}

function detectCategory(sentence: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((w) => sentence.includes(w))) return rule.key
  }
  return ''
}

/** 期限や優先度を表す語を件名から落として、実行内容だけを残す */
function cleanTitle(sentence: string): string {
  return sentence
    .replace(/(今日中|本日中|大至急|至急|最優先|急ぎ)(に|で|には)?/g, '')
    .replace(/(\d{4}-\d{2}-\d{2})(までに|まで|に)?/g, '')
    .replace(/(\d{1,2}\s*[月\/]\s*\d{1,2}\s*日?)(までに|まで|に)?/g, '')
    .replace(/(明後日|あさって|明日|あした|あす|今日|本日|今月末|月末|今週末|週末)(までに|まで|に)?/g, '')
    .replace(/((再来週|来週|今週)?\s*[日月火水木金土]曜日?)(までに|まで|に)?/g, '')
    .replace(/(再来週|来週)(までに|まで|に)?/g, '')
    .replace(/(\d{1,2}\s*日後)(までに|まで|に)?/g, '')
    .replace(/([0-2]?\d\s*時\s*半|[0-2]?\d\s*時\s*\d{1,2}\s*分|[0-2]?\d\s*時|[0-2]?\d:[0-5]\d)(から|に|より)?/g, '')
    .replace(/^[\s、。,.･・]+|[\s、。,.･・]+$/g, '')
    .trim()
}

/**
 * 自然文 → タスク候補。
 * 1文＝1タスクを基本とし、実行内容が読み取れない断片は捨てる。
 */
export function localParse(text: string, source: Source, today = dayKey()): Draft[] {
  const sentences = splitSentences(text)
  const drafts: Draft[] = []
  for (const sentence of sentences) {
    const due = extractDue(sentence, today)
    const dueTime = extractTime(sentence)
    const title = cleanTitle(sentence)
    if (title.length < 2) continue
    drafts.push({
      ...emptyDraft(source),
      title,
      // 元の文は note に残す。AI と違って要約できないので、削った情報の逃げ道にする。
      note: title === sentence.trim() ? '' : sentence.trim(),
      due,
      dueTime,
      priority: detectPriority(sentence, due, today),
      category: detectCategory(sentence),
    })
  }
  // 1件も取れなかったときは、入力そのものを1件の候補にする（捨てない）
  if (drafts.length === 0 && text.trim()) {
    const t = text.trim()
    const due = extractDue(t, today)
    drafts.push({
      ...emptyDraft(source),
      title: t.slice(0, 80),
      note: t.length > 80 ? t : '',
      due,
      dueTime: extractTime(t),
      priority: detectPriority(t, due, today),
      category: detectCategory(t),
    })
  }
  return drafts
}

/** プロンプトや画面に出す「今日は 2026-08-18（火）」の表記 */
export function todayLabel(today = dayKey()): string {
  return `${today}（${weekdayLabel(today)}）`
}
