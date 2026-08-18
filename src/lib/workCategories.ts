import { ulid } from './ulid'
import {
  CATEGORY_COLORS,
  UNCATEGORIZED,
  UNGROUPED,
  type CategoryColor,
  type CategoryGroup,
} from '../types'

/* =========================================================
 * 業務分類（区分）のマスタと、その扱い
 *
 * 既定値は実際に使っている資材課日報の「作業内容」をそのまま持ってきた。
 * ただし v1.11.0 から **マスタは設定（Settings.categoryGroups）が持ち、
 * 利用者が画面から編集できる**。ここにあるのは「初回に入れる中身」と、
 * グループを引くための道具だけ。
 *
 * グループは集計の単位（日報の「〜合計」）であり、色分けの単位でもある。
 * 色は名前（indigo など）だけを持ち、実際の値は tokens.css の `--cat-*`。
 * =======================================================*/

/** 既定のマスタ。IDは固定（保存に残るが、名前を変えても追える） */
const DEFAULT_GROUPS: { id: string; name: string; color: CategoryColor; items: string[] }[] = [
  {
    id: 'g-tehai',
    name: '手配・納期対応',
    color: 'indigo',
    items: [
      '客先連絡対応、メール確認',
      '見積依頼',
      '発注業務、所要量確認',
      '生産計画、直近予定',
      '商談・価格交渉',
      '納期確認、日程調整',
      '外注先対応',
    ],
  },
  {
    id: 'g-denpyo',
    name: '伝票処理',
    color: 'violet',
    items: [
      '受注処理',
      '売上処理',
      '検収・照合作業(部品確認)',
      '入出庫処理',
      '仕入処理',
      '伝票・請求書処理',
      '原価作成',
    ],
  },
  {
    id: 'g-zaiko',
    name: '在庫管理',
    color: 'teal',
    items: ['在庫確認、処理', '現品票、QR発行・貼付け', '部品取り、収集、移動', '棚卸'],
  },
  {
    id: 'g-shiire',
    name: '仕入先交渉',
    color: 'magenta',
    items: ['仕入先面談', '品質交渉確認', '価格交渉確認', '納期交渉確認'],
  },
  {
    id: 'g-uchiawase',
    name: '打合せ',
    color: 'blue',
    items: ['打合せ、来客対応', 'ミッション活動'],
  },
  {
    id: 'g-shorui',
    name: '書類作成',
    color: 'olive',
    items: ['書類作成、客先システム入力', 'マスタメンテナンス', '資料確認'],
  },
  {
    id: 'g-butsuryu',
    name: '物流対応',
    color: 'green',
    items: ['荷下ろし', '資材倉庫整理、レイアウト', '出荷、返品段取り'],
  },
  {
    id: 'g-sonota',
    name: 'その他',
    color: 'slate',
    items: [
      '品質保証、品質管理対応',
      '応援、試作、修正',
      '業務引継ぎ',
      'その他(朝礼、掃除など)',
      '不明',
    ],
  },
]

/** 初回に入れるマスタ。呼ぶたびに新しい配列を返す（触っても既定が汚れない）。 */
export function defaultCategoryGroups(): CategoryGroup[] {
  return DEFAULT_GROUPS.map((g) => ({ ...g, items: [...g.items] }))
}

/** 保存から読んだマスタを現行の形へ寄せる。壊れていれば既定に戻す。 */
export function normalizeGroups(raw: unknown): CategoryGroup[] {
  if (!Array.isArray(raw)) return defaultCategoryGroups()
  const groups: CategoryGroup[] = []
  for (const g of raw) {
    if (typeof g !== 'object' || g === null) continue
    const o = g as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) continue
    const items = Array.isArray(o.items)
      ? [...new Set(o.items.filter((i): i is string => typeof i === 'string' && i.trim() !== ''))]
      : []
    groups.push({
      id: typeof o.id === 'string' && o.id ? o.id : ulid(),
      name,
      color: CATEGORY_COLORS.includes(o.color as CategoryColor) ? (o.color as CategoryColor) : 'slate',
      items,
    })
  }
  return groups.length > 0 ? groups : defaultCategoryGroups()
}

/** 選択肢をすべて平らに並べたもの */
export function allCategories(groups: CategoryGroup[]): string[] {
  return groups.flatMap((g) => g.items)
}

/** 小分類 → グループ名 */
function indexOf(groups: CategoryGroup[]): Map<string, CategoryGroup> {
  const map = new Map<string, CategoryGroup>()
  for (const g of groups) for (const i of g.items) if (!map.has(i)) map.set(i, g)
  return map
}

/** 区分がどのグループに属するか。マスタに無ければ null。 */
export function findGroup(groups: CategoryGroup[], category: string): CategoryGroup | null {
  const c = category.trim()
  if (!c) return null
  return indexOf(groups).get(c) ?? null
}

/** 区分のグループ名。空なら「未分類」、マスタ外なら「その他」。 */
export function groupOf(groups: CategoryGroup[], category: string): string {
  const c = category.trim()
  if (!c) return UNCATEGORIZED
  return findGroup(groups, c)?.name ?? UNGROUPED
}

/** グループ名 → 色。無ければ既定色（グラフの取り違えを防ぐため必ず何か返す）。 */
export function colorOfGroup(groups: CategoryGroup[], groupName: string): CategoryColor {
  return groups.find((g) => g.name === groupName)?.color ?? 'slate'
}

/** 区分の色。カードのチップとグラフで同じ色になるようにここを通す。 */
export function colorOf(groups: CategoryGroup[], category: string): CategoryColor {
  return findGroup(groups, category)?.color ?? 'slate'
}

/** タスクの主区分（先頭）。集計と日報はここだけを見る。 */
export function primaryCategory(categories: string[]): string {
  return categories.find((c) => c.trim() !== '')?.trim() ?? ''
}

/** 区分の並びをならす（前後の空白を落とし、重複と空を捨てる） */
export function cleanCategories(list: string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const c = raw.trim()
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/* ---------------------------------------------------------
 * 自然文からの区分の割り当て
 * ------------------------------------------------------- */

/**
 * 語 → 小分類。上から順に見て、当たったものを使う。
 * 迷ったら当てないほうがよい（誤った区分が入ると集計が狂う）ので、
 * 判別しやすい語だけを並べている。
 */
const RULES: { words: string[]; category: string }[] = [
  { words: ['見積'], category: '見積依頼' },
  { words: ['発注', '所要量'], category: '発注業務、所要量確認' },
  { words: ['納期', '注残', '前倒し', '日程調整'], category: '納期確認、日程調整' },
  { words: ['外注'], category: '外注先対応' },
  { words: ['生産計画', '生産予定', '直近予定'], category: '生産計画、直近予定' },
  { words: ['価格交渉', '商談'], category: '商談・価格交渉' },
  { words: ['メール', '返信', '客先連絡', '電話', '連絡'], category: '客先連絡対応、メール確認' },

  { words: ['受注'], category: '受注処理' },
  { words: ['売上'], category: '売上処理' },
  { words: ['検収', '照合'], category: '検収・照合作業(部品確認)' },
  { words: ['入出庫', '出庫', '入庫'], category: '入出庫処理' },
  { words: ['仕入'], category: '仕入処理' },
  { words: ['伝票', '請求書'], category: '伝票・請求書処理' },
  { words: ['原価'], category: '原価作成' },

  { words: ['棚卸'], category: '棚卸' },
  { words: ['現品票', 'QR'], category: '現品票、QR発行・貼付け' },
  { words: ['部品取り', '収集', '移動'], category: '部品取り、収集、移動' },
  { words: ['在庫', '欠品', '引当'], category: '在庫確認、処理' },

  { words: ['仕入先面談'], category: '仕入先面談' },
  { words: ['品質交渉'], category: '品質交渉確認' },
  { words: ['納期交渉'], category: '納期交渉確認' },

  { words: ['打合せ', '打ち合わせ', '来客', 'ミーティング', '会議'], category: '打合せ、来客対応' },
  { words: ['ミッション'], category: 'ミッション活動' },

  { words: ['マスタ'], category: 'マスタメンテナンス' },
  { words: ['資料'], category: '資料確認' },
  { words: ['書類', '稟議', '報告書', '日報', '議事録'], category: '書類作成、客先システム入力' },

  { words: ['荷下ろし', '荷降ろし'], category: '荷下ろし' },
  { words: ['倉庫', 'レイアウト'], category: '資材倉庫整理、レイアウト' },
  { words: ['出荷', '返品', '段取り'], category: '出荷、返品段取り' },

  { words: ['品質保証', '品質管理', '不具合', 'クレーム'], category: '品質保証、品質管理対応' },
  { words: ['試作', '応援'], category: '応援、試作、修正' },
  { words: ['引継'], category: '業務引継ぎ' },
  { words: ['朝礼', '掃除'], category: 'その他(朝礼、掃除など)' },
]

/** 何件まで自動で当てるか。多く当てるほど外れも増えるので2件で止める。 */
const DETECT_MAX = 2

/**
 * 文から区分を推し当てる。当てられなければ空の配列（＝人が選ぶ）。
 *
 * 見る順は (1) マスタに書かれた区分名そのもの (2) 語の表。
 * (1) を先に見るのは、利用者が足した区分（コードには無い語）を拾うため。
 */
export function detectCategories(sentence: string, groups: CategoryGroup[]): string[] {
  const hit: string[] = []
  const push = (c: string) => {
    if (c && !hit.includes(c) && hit.length < DETECT_MAX) hit.push(c)
  }

  for (const c of allCategories(groups)) {
    // 「在庫確認、処理」のような区分名は、頭の語（在庫確認）で当てる
    const head = c.split(/[、,（(]/)[0].trim()
    if (head.length >= 2 && sentence.includes(head)) push(c)
  }
  const known = new Set(allCategories(groups))
  for (const rule of RULES) {
    if (hit.length >= DETECT_MAX) break
    // マスタから消された区分は当てない（消したものが戻ってくると混乱する）
    if (!known.has(rule.category)) continue
    if (rule.words.some((w) => sentence.includes(w))) push(rule.category)
  }
  return hit
}

/** 1件だけ当てる（確認画面の要約など、1つしか置けない場所で使う） */
export function detectCategory(sentence: string, groups: CategoryGroup[]): string {
  return detectCategories(sentence, groups)[0] ?? ''
}

/**
 * 新しく足す区分を、どのグループへ入れるか見当づける。
 * 語の表で当てて、その区分が居るグループへ寄せる。当たらなければ末尾のグループ。
 */
export function guessGroupId(name: string, groups: CategoryGroup[]): string {
  const n = name.trim()
  if (!n) return groups[groups.length - 1]?.id ?? ''
  for (const rule of RULES) {
    if (!rule.words.some((w) => n.includes(w))) continue
    const g = findGroup(groups, rule.category)
    if (g) return g.id
  }
  // 「その他」があればそこへ、無ければ末尾
  const other = groups.find((g) => g.name === UNGROUPED)
  return (other ?? groups[groups.length - 1])?.id ?? ''
}
