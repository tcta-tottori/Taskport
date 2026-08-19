import type { Plan, Recording, Settings, Task, TaskTemplate, PlanRun } from '../types'

/**
 * 保存層の境界。
 *
 * 画面コンポーネントは必ずこのインターフェース経由でデータに触る。
 * IndexedDB を直接叩かないこと。Phase 3 で共有ストレージ（GAS +
 * スプレッドシート）へ差し替えるとき、画面側を書き直さずに済ませるための線。
 */
export interface Repository {
  list(): Promise<Task[]>
  add(tasks: Task[]): Promise<void>
  update(id: string, patch: Partial<Task>): Promise<void>
  remove(id: string): Promise<void>

  /** 設定の読み書き。保存先はタスクと同じ層に置く。 */
  loadSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>

  /** バックアップ用の全置換（JSON取り込み） */
  replaceAll(tasks: Task[]): Promise<void>

  /* --- 端末どうしの同期 --- */

  /**
   * 消したタスクの跡（墓標）。ID → 消した時刻。
   * これが無いと、消したはずのタスクが相手の端末から戻ってくる。
   */
  listTombstones(): Promise<Record<string, string>>

  /**
   * 併合の結果を手元へ書き戻す。1つの取引でまとめて行う。
   * @param upsert  入れ直すタスク
   * @param removeIds 消すタスクのID
   * @param tombstones 併合後の墓標（丸ごと置き換える）
   */
  applySync(
    upsert: Task[],
    removeIds: string[],
    tombstones: Record<string, string>,
  ): Promise<void>

  /**
   * 保存データそのものを作り直す。**中身は消える。**
   * 保存領域が壊れて開けなくなったときの最後の手段。
   * 必ず利用者に確かめてから呼ぶこと。
   */
  resetLedger(): Promise<void>

  /* --- 記憶したタスク（定型）。端末内にのみ置く --- */

  /** 呼び出せる定型の一覧。並びは呼び出し側で決める。 */
  listTemplates(): Promise<TaskTemplate[]>
  /** 丸ごと置き換える（件数が少なく、1件ずつ更新する利点が無い） */
  saveTemplates(list: TaskTemplate[]): Promise<void>

  /* --- 予定（打合せ・固定の業務）。台帳とは別のDBに置く ---
     タスクと混ぜないのは、完了の丸が付いてしまうのと、
     見込み時間の積み上げが二重になるため（design.md §10.1）。 */

  listPlans(): Promise<Plan[]>
  savePlan(plan: Plan): Promise<void>
  removePlan(id: string): Promise<void>
  /** バックアップの取り込み用。丸ごと入れ替える */
  replaceAllPlans(plans: Plan[]): Promise<void>

  /* --- 予定の実行ログ（開始・一時停止・終了） ---
     タスクの実績は台帳（Task.startedAt / actualMin）が持つ。ここは予定ぶんだけ。
     実績なので記録は書き換えず積むだけにし、古い日のぶんは起動時に捨てる。 */

  /** @param fromDay これ以降の日のぶんだけ返す（省略すると全部） */
  listRuns(fromDay?: string): Promise<PlanRun[]>
  saveRun(run: PlanRun): Promise<void>
  /** まとめて保存する（自動計上で複数が同時に動くため） */
  saveRuns(runs: PlanRun[]): Promise<void>
  removeRun(id: string): Promise<void>
  /** 指定の日より前の記録を捨てる。戻り値は捨てた件数 */
  pruneRuns(beforeDay: string): Promise<number>

  /* --- 録音。音声は端末内にのみ置く --- */
  listRecordings(): Promise<Recording[]>
  addRecording(rec: Recording, audio: Blob | null): Promise<void>
  /** 再生用に音声を取り出す。残っていなければ null */
  getRecordingAudio(id: string): Promise<Blob | null>
  removeRecording(id: string): Promise<void>
  updateRecording(id: string, patch: Partial<Recording>): Promise<void>
}
