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
 * 会社カレンダー
 * ------------------------------------------------------- */

/**
 * 会社の休日・出勤日。
 *
 * 曜日だけでは実際の勤務日と合わない。祝日・一斉有給・年末年始は休みだし、
 * 逆に土曜出勤の日もある。ここに実日付で持ち、稼働日の判定を上書きする。
 *
 * 端末どうしで同じものを使いたいので、同期にも乗せる（更新時刻の新しいほう）。
 */
export interface WorkCalendar {
  /** 休みにする日 "YYYY-MM-DD" */
  holidays: string[]
  /** 出勤にする日 "YYYY-MM-DD"。土曜出勤など。休日より優先する */
  workdays: string[]
  /** 取り込み元のカレンダーID（Googleカレンダー）。空なら手入力だけ */
  sourceCalendarId: string
  /** 最後に触った時刻（同期の突き合わせに使う） */
  updatedAt: string
}

export const EMPTY_WORK_CALENDAR: WorkCalendar = {
  holidays: [],
  workdays: [],
  sourceCalendarId: '',
  updatedAt: '1970-01-01T00:00:00.000Z',
}

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
  /**
   * 実際に手を付けた時刻（ISO 8601）。null は手つかず。
   * 未完了でこれが入っていれば **実行中**。完了したあとは
   * 「その日いつから始めたか」の記録として残り、日報の枠決めに使う。
   */
  startedAt: string | null
  /**
   * 実際にかかった時間（分）。null は測っていない。
   * `estimateMin`（見込み）とは別物で、**混ぜて数えない**。
   * 日報と「区分ごとの時間」は、これが入っていればこちらを使う。
   */
  actualMin: number | null
  priority: Priority
  /**
   * 業務分類。複数選べる（1つの作業が発注と納期確認の両方にまたがることがある）。
   * 候補は Settings.categoryGroups のマスタ。ここに無い語も入れられる。
   *
   * **先頭が主区分**。日報の書き出しと「区分ごとの時間」は先頭だけで数える
   * （全部に同じ時間を積むと合計が実時間を超えて、稼働の判断が狂う）。
   */
  categories: string[]
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
   *
   * **期限が無くても持てる**（v1.14.0）。その場合は済ませた日を起点にして
   * 次回の日を決め、次回ぶんには期限が入る（`lib/repeat.ts`）。
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
 * 区分（業務分類）のマスタ
 *
 * 日報の作業内容から起こした既定値を持つが、**利用者が編集できる**。
 * 実際の仕事は増えるし、名前も変わる。コードを直さないと足せない形にしない。
 * ------------------------------------------------------- */

/**
 * グループの色。値そのものは tokens.css の `--cat-*` で決める。
 * ここに16進数を書かない（色はトークンからしか取らない）。
 */
export const CATEGORY_COLORS = [
  'indigo',
  'violet',
  'magenta',
  'rose',
  'amber',
  'olive',
  'green',
  'teal',
  'blue',
  'slate',
] as const

export type CategoryColor = (typeof CATEGORY_COLORS)[number]

/** 区分のまとまり。集計の単位でもあり、色分けの単位でもある。 */
export interface CategoryGroup {
  /** ULID か既定グループの固定ID */
  id: string
  /** 表示名。集計と絞り込みではこの名前を鍵に使う */
  name: string
  color: CategoryColor
  /** このグループに属する区分 */
  items: string[]
}

/** どのグループにも入っていない区分をまとめる名前 */
export const UNGROUPED = 'その他'
/** 区分が空のタスクをまとめる名前 */
export const UNCATEGORIZED = '未分類'

/* ---------------------------------------------------------
 * 記憶したタスク（定型）
 *
 * 同じ作業を毎回打ち直さないための控え。登録した時点で自動的に控え、
 * 直接入力の画面から呼び出して1タップで埋める。
 * 端末内にのみ置き、同期にも書き出しにも乗せない。
 * ------------------------------------------------------- */

export interface TaskTemplate {
  /** ULID */
  id: string
  title: string
  note: string
  categories: string[]
  priority: Priority
  estimateMin: number | null
  timebox: TimeboxKey | null
  /** 手順の見出しだけ。済／未了は引き継がない */
  steps: string[]
  /** 同じ件名で何回作ったか。よく使う順に並べるのに使う */
  useCount: number
  /** 最後に使った時刻 ISO 8601 */
  lastUsedAt: string
}

/** 端末に残す定型の件数。あふれたら「使った回数が少なく・古い」ものから捨てる。 */
export const TEMPLATE_KEEP = 200

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
  /** 稼働曜日。0=日 〜 6=土。会社カレンダーがあればそちらが優先される */
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
  /** 会社の休日・出勤日。曜日の設定より優先する */
  workCalendar: WorkCalendar
  /**
   * 区分のマスタ。グループ分けと色をここで持ち、設定画面と区分の選択画面から編集する。
   * 空の配列は「読み込み前」を意味する（保存層が既定値で埋める）。
   */
  categoryGroups: CategoryGroup[]
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
  /**
   * 端末どうしの同期を使うか。
   * 入れると**タスクの本文が Google Drive（アプリ専用フォルダ）に保存される**。
   * 既定は切。
   */
  syncEnabled: boolean
  /** 期限のリマインドを出すか */
  reminderEnabled: boolean
  /** 何分前に出すか。0 は時刻ちょうど */
  reminderLeadMin: number
}

export const DEFAULT_SETTINGS: Settings = {
  workHours: DEFAULT_WORK_HOURS,
  workCalendar: EMPTY_WORK_CALENDAR,
  // 既定のマスタは lib/workCategories.ts が持つ（型の定義がデータを抱えないようにする）。
  // 保存層が読み込むときに埋める。
  categoryGroups: [],
  defaultEstimateMin: 30,
  voiceEnabled: true,
  keepAudio: true,
  keepAwake: false,
  googleClientId: '',
  googleCalendarId: 'primary',
  savedFilters: [],
  syncEnabled: false,
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
  /**
   * 終日予定の終わり "YYYY-MM-DD"（Google の値そのまま＝翌日を指す）。
   * 年末年始のように何日かにまたがる予定を展開するのに使う。
   */
  endDay: string | null
  /** "HH:mm"。終日予定は null */
  startTime: string | null
  endTime: string | null
  /** 終日予定か */
  allDay: boolean
  location: string
  /** Googleカレンダー上のURL */
  htmlLink: string
}
