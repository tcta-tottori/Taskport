/* =========================================================
 * Taskport 型定義
 *
 * タスク構造はここに集約する。各ファイルで独自のタスク型を定義しない。
 * 日付は必ず文字列 "YYYY-MM-DD"、時刻は "HH:mm" で保持する
 * （Date をそのまま保存するとタイムゾーンの事故が起きる）。
 * =======================================================*/

export type Priority = 'high' | 'mid' | 'low'
export type Status = 'open' | 'done'
export type Source = 'voice' | 'text' | 'form' | 'share' | 'calendar'

export interface Task {
  /** ULID（時系列にソート可能なID） */
  id: string
  /** 「〜する」で終わる実行形 */
  title: string
  /** 相手先・数量・背景などの補足 */
  note: string
  /** "YYYY-MM-DD"。期限なしは null */
  due: string | null
  /** "HH:mm"。時刻指定がある予定のみ */
  dueTime: string | null
  /**
   * 見込み所要時間（分）。null は「未見積」。
   * スケジュールビューの帯の長さと、勤務時間に対する積み上げ量の計算に使う。
   */
  estimateMin: number | null
  priority: Priority
  /** 発注 / 納期確認 / 在庫 / 社内資料 / 会議 / 通関 など自由入力 */
  category: string
  status: Status
  /** どの入口から入ったか（どの入口を育てるかの判断に使う） */
  source: Source
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

/** AIが提案した未保存のタスク候補。確認画面（ReviewSheet）でのみ存在する。 */
export interface Draft extends Omit<Task, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'doneAt'> {
  tempId: string
}

export const PRIORITIES: Priority[] = ['high', 'mid', 'low']

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: '高',
  mid: '中',
  low: '低',
}

export const SOURCE_LABEL: Record<Source, string> = {
  voice: '音声',
  text: '自然文',
  form: 'フォーム',
  share: '共有',
  calendar: 'カレンダー',
}

/** 実運用で頻出しやすい区分。マスタ管理はせず、入力補助にとどめる。 */
export const CATEGORY_SUGGESTIONS = [
  '発注',
  '納期確認',
  '在庫',
  '社内資料',
  '会議',
  '通関',
  '連絡',
  'その他',
]

/* ---------------------------------------------------------
 * 勤務時間
 * ------------------------------------------------------- */

export interface WorkHours {
  /** 始業 "HH:mm" */
  start: string
  /** 昼休憩の開始 "HH:mm" */
  breakStart: string
  /** 昼休憩の終了 "HH:mm" */
  breakEnd: string
  /** 終業 "HH:mm" */
  end: string
  /** 稼働曜日。0=日 〜 6=土 */
  workDays: number[]
}

/**
 * 勤務時間の既定値。
 * 利用者の実際の勤務に合わせた値で、設定画面から変更できる。
 *   始業 8:20 / 昼休憩 12:20〜13:05 / 終業 17:10
 *   → 実働 4時間00分 + 4時間05分 = 8時間05分（485分）
 */
export const DEFAULT_WORK_HOURS: WorkHours = {
  start: '08:20',
  breakStart: '12:20',
  breakEnd: '13:05',
  end: '17:10',
  workDays: [1, 2, 3, 4, 5],
}

export interface Settings {
  workHours: WorkHours
  /** 見積が未入力のタスクを稼働量に積むときの既定値（分） */
  defaultEstimateMin: number
  /** AI構造化プロキシのURL。空なら端末内のかんたん解析にフォールバックする */
  parseEndpoint: string
  /** 音声入力を使うか（非対応環境では自動的に false 扱い） */
  voiceEnabled: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  workHours: DEFAULT_WORK_HOURS,
  defaultEstimateMin: 30,
  parseEndpoint: '',
  voiceEnabled: true,
}
