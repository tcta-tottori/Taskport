/* =========================================================
 * 業務分類マスタ
 *
 * 実際に使っている資材課日報の「作業内容」をそのまま持ってきた。
 * design.md §5.1 は「区分は自由入力とし、マスタ管理はしない。実運用で
 * 頻出する語が固まってから候補化する」としていたが、日報の様式として
 * 既に固まっていたので、その語をそのまま候補にする。
 *
 * 大分類は日報の集計単位でもある（分析画面の「区分ごとの時間」で使う）。
 * 自由入力は残す。ここに無い区分を書いても「その他」として集計される。
 * =======================================================*/

export interface CategoryGroup {
  /** 集計の単位。日報の「〜合計」に対応する */
  group: string
  /** 選択肢。日報の作業内容の行に対応する */
  items: string[]
}

export const CATEGORY_MASTER: CategoryGroup[] = [
  {
    group: '手配・納期対応',
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
    group: '伝票処理',
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
    group: '在庫管理',
    items: ['在庫確認、処理', '現品票、QR発行・貼付け', '部品取り、収集、移動', '棚卸'],
  },
  {
    group: '仕入先交渉',
    items: ['仕入先面談', '品質交渉確認', '価格交渉確認', '納期交渉確認'],
  },
  {
    group: '打合せ',
    items: ['打合せ、来客対応', 'ミッション活動'],
  },
  {
    group: '書類作成',
    items: ['書類作成、客先システム入力', 'マスタメンテナンス', '資料確認'],
  },
  {
    group: '物流対応',
    items: ['荷下ろし', '資材倉庫整理、レイアウト', '出荷、返品段取り'],
  },
  {
    group: 'その他',
    items: [
      '品質保証、品質管理対応',
      '応援、試作、修正',
      '業務引継ぎ',
      'その他(朝礼、掃除など)',
      '不明',
    ],
  },
]

/** 選択肢をすべて平らに並べたもの（入力補助の datalist 用） */
export const CATEGORY_ITEMS: string[] = CATEGORY_MASTER.flatMap((g) => g.items)

/** 小分類 → 大分類 */
const GROUP_OF = new Map<string, string>(
  CATEGORY_MASTER.flatMap((g) => g.items.map((i) => [i, g.group] as const)),
)

/** 区分がどの大分類に属するか。マスタに無ければ「その他」。 */
export function groupOf(category: string): string {
  const c = category.trim()
  if (!c) return '未分類'
  return GROUP_OF.get(c) ?? 'その他'
}

/* ---------------------------------------------------------
 * 自然文からの区分の割り当て
 * ------------------------------------------------------- */

/**
 * 語 → 小分類。上から順に見て、最初に当たったものを使う。
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

/** 文から区分を推し当てる。当てられなければ空文字（＝未分類のまま人が選ぶ）。 */
export function detectCategory(sentence: string): string {
  for (const rule of RULES) {
    if (rule.words.some((w) => sentence.includes(w))) return rule.category
  }
  return ''
}
