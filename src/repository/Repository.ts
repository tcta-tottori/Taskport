import type { Recording, Settings, Task } from '../types'

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

  /**
   * 保存データそのものを作り直す。**中身は消える。**
   * 保存領域が壊れて開けなくなったときの最後の手段。
   * 必ず利用者に確かめてから呼ぶこと。
   */
  resetLedger(): Promise<void>

  /* --- 録音。音声は端末内にのみ置く --- */
  listRecordings(): Promise<Recording[]>
  addRecording(rec: Recording, audio: Blob | null): Promise<void>
  /** 再生用に音声を取り出す。残っていなければ null */
  getRecordingAudio(id: string): Promise<Blob | null>
  removeRecording(id: string): Promise<void>
  updateRecording(id: string, patch: Partial<Recording>): Promise<void>
}
