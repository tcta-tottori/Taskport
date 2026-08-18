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

/* ---------------------------------------------------------
 * タイムボックス（時間枠）
 * ------------------------------------------------------- */

/**
 * その日のどの時間帯にやるか。
 * 枠は勤務時間の区切りそのもの（日報の時間区分と同じ）で、
 * 午前2枠・午後2枠に、収まらないぶんの「時間外」を足した5つ。
 *
 * 「何時ちょうどにやる」ではなく「どの帯でやる」を決めるための粗さにしてある。
 * 分刻みで決めると、少し狂っただけで全部組み直すことになる。
 */
export type TimeboxKey = 'am1' | 'am2' | 'pm1' | 'pm2' | 'out'

/* ---------------------------------------------------------
 * サブタスク
 * ------------------------------------------------------- */

/**
 * タスクの中の手順。1つの作業が何工程かに分かれるとき（棚卸など）に使う。
 * 入れ子はここまで。サブタスクの中にサブタスクは作らない
 * （階層が増えると、いま何をやるかを探す手間のほうが大きくなる）。
 */
export interface Subtask {
  /** ULID */
  id: string
  title: string
  done: boolean
}

/* ---------------------------------------------------------
 * 繰り返し
 * ------------------------------------------------------- */

/**
 * 繰り返しの単位。
 * 「2週おき」のような間隔は持たない。日報・週次会議・棚卸・月初集計という
 * 実際の定例がこの5つで足りるため（design.md §10.1）。
 */
export type RepeatUnit =
  /** 毎日 */
  | 'day'
  /** 稼働曜日ごと（設定の workDays に従う） */
  | 'workday'
  /** 毎週。曜日は weekdays で指定 */
  | 'week'
  /** 毎月おなじ日。無い日（31日など）はその月の末日に寄せる */
  | 'month'
  /** 毎月末 */
  | 'monthEnd'

export interface Repeat {
  unit: RepeatUnit
  /** unit==='week' の曜日（0=日 〜 6=土）。空なら期限の曜日を使う */
  weekdays: number[]
  /** この日を過ぎたら次を作らない "YYYY-MM-DD"。null は終わりなし */
  until: string | null
}

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
  /** 業務分類。候補は lib/workCategories.ts のマスタ。自由入力も可 */
  category: string
  status: Status
  /** どの入口から入ったか（どの入口を育てるかの判断に使う） */
  source: Source
  /** 手順。空なら持たない。 */
  subtasks: Subtask[]
  /**
   * その日のどの時間帯にやるか。null は未割り当て。
   * 時刻（dueTime）とは別物で、こちらは「帯」だけを決める。
   */
  timebox: TimeboxKey | null
  /**
   * 繰り返しの設定。null は繰り返さない。
   * 完了にした時点で次回ぶんを別のタスクとして作る（自動で溜め込まない）。
   * 期限が無いタスクには付けられない（次回の日が決まらないため）。
   */
  repeat: Repeat | null
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

/* ---------------------------------------------------------
 * 勤務時間
 * ------------------------------------------------------- */

/** 昼休憩以外の短い休憩（午前・午後の小休止） */
export interface ShortBreak {
  /** "HH:mm" */
  start: string
  end: string
}

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
  /** 小休憩。実働から差し引き、タイムラインにも出す */
  shortBreaks: ShortBreak[]
}

/**
 * 勤務時間の既定値。
 * 実際に使っている資材課日報の時間枠に合わせてある。設定画面から変更できる。
 *
 *   8:20〜10:20（120分）／ 小休憩 10:20〜10:25
 *   10:25〜12:25（120分）／ 昼休憩 12:25〜13:05
 *   13:05〜15:05（120分）／ 小休憩 15:05〜15:10
 *   15:10〜17:10（120分）
 *   → 実働 480分（8時間ちょうど）
 */
export const DEFAULT_WORK_HOURS: WorkHours = {
  start: '08:20',
  breakStart: '12:25',
  breakEnd: '13:05',
  end: '17:10',
  workDays: [1, 2, 3, 4, 5],
  shortBreaks: [
    { start: '10:20', end: '10:25' },
    { start: '15:05', end: '15:10' },
  ],
}

/* ---------------------------------------------------------
 * 録音
 * ------------------------------------------------------- */

/**
 * 1回の録音。音声そのものは別ストアに置き、ここは一覧に出す情報だけ持つ。
 * 音声は端末内にしか置かない（外部へ送信しない）。
 */
export interface Recording {
  /** ULID */
  id: string
  createdAt: string
  /** 録音時間（秒） */
  durationSec: number
  /** 認識できたテキスト */
  transcript: string
  /** 音声の形式（audio/mp4 など）。音声が残らなかった場合は空 */
  mimeType: string
  /** 音声のバイト数。0 なら音声なし */
  bytes: number
  /** この録音から登録したタスクのID */
  taskIds: string[]
  /** 取りこぼしなどの注意（あれば） */
  warning: string | null
}

/** 端末に残す録音の本数。古いものから消す。 */
export const RECORDING_KEEP = 20

/* ---------------------------------------------------------
 * 検索と絞り込み
 * ------------------------------------------------------- */

/** 期限での絞り込みの範囲 */
export type DueRange = 'any' | 'overdue' | 'today' | 'week' | 'later' | 'none'

export interface TaskFilter {
  /** 空白区切りで AND。件名・メモ・区分を見る */
  q: string
  /** 大分類（workCategories の group）。空なら絞らない */
  groups: string[]
  /** 空なら絞らない */
  priorities: Priority[]
  due: DueRange
  /** 完了したタスクも対象にするか */
  includeDone: boolean
}

/** 保存した絞り込み。端末内にのみ置く。 */
export interface SavedFilter {
  /** ULID */
  id: string
  name: string
  filter: TaskFilter
}

export interface Settings {
  workHours: WorkHours
  /** 見積が未入力のタスクを稼働量に積むときの既定値（分） */
  defaultEstimateMin: number
  /** 音声入力を使うか（非対応環境では自動的に false 扱い） */
  voiceEnabled: boolean
  /** 録音した音声を端末内に残すか */
  keepAudio: boolean
  /** 録音中に画面を点けたままにするか */
  keepAwake: boolean
  /** Googleカレンダー連携のクライアントID（利用者が自分の Google Cloud で作る） */
  googleClientId: string
  /** 読み込むカレンダーID。既定は primary */
  googleCalendarId: string
  /** 保存した絞り込み。一覧の検索欄からチップで呼び出す */
  savedFilters: SavedFilter[]
  /** 期限のリマインドを出すか */
  reminderEnabled: boolean
  /** 何分前に出すか。0 は時刻ちょうど */
  reminderLeadMin: number
}

export const DEFAULT_SETTINGS: Settings = {
  workHours: DEFAULT_WORK_HOURS,
  defaultEstimateMin: 30,
  voiceEnabled: true,
  keepAudio: true,
  keepAwake: false,
  googleClientId: '',
  googleCalendarId: 'primary',
  savedFilters: [],
  reminderEnabled: false,
  reminderLeadMin: 10,
}

/* ---------------------------------------------------------
 * Googleカレンダーの予定
 * ------------------------------------------------------- */

/** 読み込んだ予定。タスクとは別物として扱い、台帳には混ぜない。 */
export interface CalendarEvent {
  id: string
  title: string
  /** "YYYY-MM-DD" */
  day: string
  /** "HH:mm"。終日予定は null */
  startTime: string | null
  endTime: string | null
  /** 終日予定か */
  allDay: boolean
  location: string
  /** Googleカレンダー上のURL */
  htmlLink: string
}
